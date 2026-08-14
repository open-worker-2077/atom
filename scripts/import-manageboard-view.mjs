import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { createBossStore } from '../cli/lib/boss-store.mjs';
import { hierarchyGroups } from './lib/manageboard-hierarchy.mjs';

const execFileAsync = promisify(execFile);

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : fallback;
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`缺少 --${name}`);
  return value;
}

function cmdQuote(value) {
  const text = String(value);
  if (!/^[a-zA-Z0-9+._:-]+$/.test(text)) throw new Error('命令参数包含不安全字符');
  return text;
}

async function larkRecordPage(config, offset) {
  const args = [
    'base', '+record-list',
    '--base-token', config.baseToken,
    '--table-id', config.tableId,
    '--view-id', config.viewId,
    '--field-id', config.titleField,
    '--field-id', config.recordField,
    '--field-id', config.leaderField,
    '--field-id', config.bossField,
    '--field-id', config.administrationField,
    '--field-id', config.developmentField,
    '--limit', '200',
    '--offset', String(offset),
    '--json'
  ];
  const command = `lark-cli.cmd ${args.map(cmdQuote).join(' ')}`;
  const { stdout } = await execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  const payload = JSON.parse(stdout);
  if (!payload.ok) throw new Error(payload.error?.message || '飞书记录读取失败');
  return payload.data;
}

function scalar(value) {
  if (Array.isArray(value)) return scalar(value[0]);
  if (value && typeof value === 'object') {
    return scalar(value.record_id ?? value.id ?? value.value ?? value.text ?? value.name);
  }
  return typeof value === 'string' ? value.trim() : '';
}

function bossIdFor(relationship) {
  const known = new Map([
    ['↑ 🤖individual', 'individual'],
    ['↑ 🌠civilization_division', 'civilization-division'],
    ['↑ civilization_environment', 'civilization-environment'],
    ['→ Demand', 'downstream-demand'],
    ['↓ Requirement', 'downstream-requirement'],
    ['← Demand', 'upstream-demand']
  ]);
  if (known.has(relationship)) return known.get(relationship);
  if (!relationship) return 'unassigned';
  const slug = relationship
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!slug) throw new Error(`无法为 relationship 生成安全 Boss ID：${relationship}`);
  return slug;
}

async function main() {
  const config = {
    baseToken: required('base-token'),
    tableId: required('table-id'),
    viewId: required('view-id'),
    destination: path.resolve(required('destination')),
    titleField: option('title-field', 'fldjxRGbJt'),
    recordField: option('record-field', 'fldWVJZgoe'),
    leaderField: option('leader-field', 'fldnmKzNuk'),
    bossField: option('boss-field', 'fld1nLN18v'),
    administrationField: option('administration-field', 'flduKZ902y'),
    developmentField: option('development-field', 'fldpHG2vXT')
  };

  try {
    await fs.access(config.destination);
    throw new Error(`目标目录已经存在，拒绝覆盖：${config.destination}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const records = [];
  for (let offset = 0; ; offset += 200) {
    const page = await larkRecordPage(config, offset);
    const rows = Array.isArray(page.data) ? page.data : [];
    const ids = Array.isArray(page.record_id_list) ? page.record_id_list : [];
    rows.forEach((row, index) => {
      const recordId = scalar(row[1]) || scalar(ids[index]);
      const label = scalar(row[0]);
      const relationship = scalar(row[3]);
      if (!recordId || !label) throw new Error(`视图中存在缺少稳定 ID 或节点标题的记录（offset ${offset + index}）`);
      records.push({
        recordId,
        label,
        relationship,
        bossId: bossIdFor(relationship),
        administration: scalar(row[4]),
        development: scalar(row[5])
      });
    });
    if (!page.has_more) break;
    if (!rows.length) throw new Error('飞书分页返回 has_more=true 但没有记录');
  }

  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.recordId)) throw new Error(`视图中出现重复 Record_ID：${record.recordId}`);
    seen.add(record.recordId);
  }

  const stage = `${config.destination}.importing-${Date.now()}`;
  const store = createBossStore(stage);
  await store.init();
  const groups = new Map();
  records.forEach((record) => {
    if (!groups.has(record.bossId)) groups.set(record.bossId, []);
    groups.get(record.bossId).push(record);
  });

  let administrationLeaders = 0;
  let developmentLeaders = 0;
  for (const [bossId, group] of groups) {
    const relationship = group[0].relationship;
    await store.createBoss({ bossId, label: relationship || '未分配 relationship' });
    const hierarchy = hierarchyGroups(group);
    administrationLeaders += hierarchy.administrations.length;
    developmentLeaders += hierarchy.developments.length;
    for (const administration of hierarchy.administrations) {
      await store.execute(bossId, 'node.create', {
        id: administration.id,
        leaderId: bossId,
        label: administration.label
      });
    }
    for (const development of hierarchy.developments) {
      await store.execute(bossId, 'node.create', {
        id: development.id,
        leaderId: development.leaderId,
        label: development.label
      });
    }
    for (const record of group) {
      await store.execute(bossId, 'node.create', {
        id: record.recordId,
        leaderId: hierarchy.assignments.get(record.recordId),
        label: record.label
      });
    }
  }

  await fs.mkdir(path.dirname(config.destination), { recursive: true });
  await fs.rename(stage, config.destination);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    destination: config.destination,
    records: records.length,
    bosses: [...groups].map(([bossId, group]) => ({
      bossId,
      label: group[0].relationship || '未分配 relationship',
      nodes: group.length
    })),
    administrationLeaders,
    developmentLeaders
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
