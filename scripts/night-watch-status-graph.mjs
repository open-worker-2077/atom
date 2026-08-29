const STATUSES = new Set([
  'pending', 'passed', 'failed', 'blocked', 'revalidation-required', 'pending-user-acceptance'
]);
const ROOT_ISSUE_NUMBER = 1;
const ROOT_ISSUE_URL = 'https://github.com/open-worker-2077/atom/issues/1';
const ROOT_ISSUE_ID = 'issue-1';

function graphError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireNode(node, kind) {
  if (!node || typeof node.id !== 'string' || !node.id || !STATUSES.has(node.status)) {
    throw graphError('NIGHT_WATCH_STATUS_INVALID', `Night-watch ${kind} has an invalid id or status`);
  }
  return node;
}

function openNode(kind, node) {
  return node.status === 'passed' ? null : { kind, id: node.id, status: node.status };
}

function aggregateGateStatus(requiredStatuses, requestedStatus) {
  if (requiredStatuses.every((status) => status === 'passed')) return requestedStatus;
  for (const status of ['failed', 'blocked', 'revalidation-required', 'pending-user-acceptance', 'pending']) {
    if (requiredStatuses.includes(status)) return status;
  }
  return 'revalidation-required';
}

function listed(values, value) {
  return Array.isArray(values) && values.includes(value);
}

function isCurrentEvidence(attachment, input) {
  const candidate = attachment?.candidate;
  const timestamp = Date.parse(attachment?.timestamp);
  return Boolean(
    attachment && typeof attachment.runId === 'string' && attachment.runId
    && candidate && typeof candidate.commit === 'string' && candidate.commit
    && typeof candidate.version === 'string' && candidate.version
    && Number.isFinite(timestamp) && typeof attachment.scope === 'string' && attachment.scope
    && typeof attachment.command === 'string' && attachment.command
    && STATUSES.has(attachment.outcome) && attachment.validity === 'valid'
    && attachment.conclusive === true && attachment.outcome === 'passed'
    && (!input.expectedCommit || candidate.commit === input.expectedCommit)
    && (input.evidenceMaxAgeMilliseconds === undefined
      || Date.parse(input.now) - timestamp <= input.evidenceMaxAgeMilliseconds)
  );
}

function renderTriadStatusGraph(input) {
  if (input.issue.id !== ROOT_ISSUE_ID) {
    throw graphError('NIGHT_WATCH_ROOT_ISSUE_INVALID', 'Triad status graph requires Issue #1 stable node id');
  }
  if (!Array.isArray(input.issueInstances) || !Array.isArray(input.testCases)
    || !Array.isArray(input.evidenceAttachments)) {
    throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Triad status graph requires issue instances, test cases, and evidence attachments');
  }
  const issueById = new Map(input.issueInstances.map((issue) => [issue.id, issue]));
  const caseById = new Map(input.testCases.map((testCase) => [testCase.id, testCase]));
  const evidenceById = new Map(input.evidenceAttachments.map((evidence) => [evidence.id, evidence]));
  if (issueById.size !== input.issueInstances.length || caseById.size !== input.testCases.length
    || evidenceById.size !== input.evidenceAttachments.length) {
    throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Triad node ids must be unique');
  }
  for (const issue of issueById.values()) {
    requireNode(issue, 'Issue instance');
    if (!Number.isInteger(issue.number) || issue.rootIssueRef !== ROOT_ISSUE_ID
      || !Array.isArray(issue.testCaseRefs) || !Array.isArray(issue.evidenceRefs)) {
      throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Issue instance has an invalid managed backlink or triad references');
    }
  }
  for (const testCase of caseById.values()) {
    requireNode(testCase, 'test case');
    if (!issueById.has(testCase.issueRef) || !Array.isArray(testCase.evidenceRefs)) {
      throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Test case has an invalid Issue or evidence reference');
    }
  }

  const validFor = (issue, testCase, evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return isCurrentEvidence(evidence, input)
      && listed(issue.evidenceRefs, evidenceId)
      && listed(testCase.evidenceRefs, evidenceId)
      && listed(evidence.issueRefs, issue.id)
      && listed(evidence.testCaseRefs, testCase.id)
      && evidence.provenNodes?.some((proof) => proof.id === issue.id && typeof proof.proof === 'string' && proof.proof)
      && evidence.provenNodes?.some((proof) => proof.id === testCase.id && typeof proof.proof === 'string' && proof.proof);
  };
  const effectiveStatuses = new Map();
  const caseStatus = (issue, testCase) => {
    const mapped = testCase.evidenceRefs.some((id) => validFor(issue, testCase, id));
    const status = testCase.status === 'passed' && !mapped ? 'revalidation-required' : testCase.status;
    effectiveStatuses.set(testCase.id, status);
    return status;
  };
  const issueStatus = (issue) => {
    const cases = issue.testCaseRefs.map((id) => caseById.get(id));
    const relationsValid = cases.length > 0 && cases.every((testCase) => testCase?.issueRef === issue.id
      && caseStatus(issue, testCase) === 'passed');
    const evidenceValid = cases.every((testCase) => testCase?.evidenceRefs.some((id) => validFor(issue, testCase, id)));
    const status = issue.status === 'passed' && (!relationsValid || !evidenceValid)
      ? 'revalidation-required' : issue.status;
    effectiveStatuses.set(issue.id, status);
    return status;
  };

  const requestedIssue = input.managedIssueId === undefined ? null : issueById.get(input.managedIssueId);
  if (input.managedIssueId !== undefined && !requestedIssue) {
    throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Managed Issue block must name one known Issue instance');
  }
  const visibleIssues = requestedIssue ? [requestedIssue] : [...issueById.values()];
  const lines = ['## Night-watch delivery status', '', `- **Issue #${input.issue.number}**: existing delivery anchor`];
  let firstOpenNode = null;
  for (const issue of visibleIssues) {
    const status = issueStatus(issue);
    firstOpenNode ??= openNode('issue-instance', { ...issue, status });
    lines.push(`  - **Issue instance ${issue.id} (#${issue.number})**: ${status}`);
    lines.push('    - **Managed backlink**: Issue #1');
    for (const testCaseId of issue.testCaseRefs) {
      const testCase = caseById.get(testCaseId);
      if (!testCase) {
        lines.push(`    - **Test case ${testCaseId}**: revalidation-required`);
        effectiveStatuses.set(testCaseId, 'revalidation-required');
        continue;
      }
      const status = caseStatus(issue, testCase);
      firstOpenNode ??= openNode('test-case', { ...testCase, status });
      lines.push(`    - **Test case ${testCase.id}**: ${status}`);
      for (const evidenceId of testCase.evidenceRefs) {
        const evidence = evidenceById.get(evidenceId);
        const valid = validFor(issue, testCase, evidenceId);
        const evidenceStatus = valid ? evidence.outcome : (evidence && evidence.outcome !== 'passed' && STATUSES.has(evidence.outcome)
          ? evidence.outcome
          : 'revalidation-required');
        firstOpenNode ??= openNode('evidence', { id: evidenceId, status: evidenceStatus });
        if (!evidence) {
          lines.push(`      - **Evidence ${evidenceId}**: revalidation-required`);
          continue;
        }
        if (evidenceStatus === 'pending' || evidenceStatus === 'pending-user-acceptance') {
          lines.push(`      - **Evidence ${evidence.id}**: ${evidenceStatus}; execution: not-run`);
          continue;
        }
        lines.push(`      - **Evidence ${evidence.id}**: ${evidenceStatus}; run: ${evidence.runId}; candidate: ${evidence.candidate?.commit ?? 'unknown'}/${evidence.candidate?.version ?? 'unknown'}; timestamp: ${evidence.timestamp ?? 'unknown'}; scope: ${evidence.scope ?? 'unknown'}; command: redacted; result: ${evidence.outcome ?? 'unknown'}; validity: ${evidence.validity ?? 'invalid'}`);
      }
    }
  }
  const gates = (requestedIssue ? [] : input.gates).map((gate) => {
    requireNode(gate, 'delivery gate');
    const status = Array.isArray(gate.required)
      ? aggregateGateStatus(gate.required.map((id) => effectiveStatuses.get(id)), gate.status)
      : gate.status;
    firstOpenNode ??= openNode('delivery-gate', { ...gate, status });
    lines.push(`  - **Delivery gate ${gate.id}**: ${status}`);
    return { id: gate.id, status };
  });
  return { markdown: `${lines.join('\n')}\n`, firstOpenNode, gates };
}

export function renderNightWatchStatusGraph(input) {
  if (!input?.issue || input.issue.number !== ROOT_ISSUE_NUMBER
    || (input.issue.url !== undefined && input.issue.url !== ROOT_ISSUE_URL)) {
    throw graphError('NIGHT_WATCH_ROOT_ISSUE_INVALID', 'Night-watch status graph must use Issue #1 as its unique management root');
  }
  if (!Number.isInteger(input.issue.number)) {
    throw graphError('NIGHT_WATCH_ISSUE_INVALID', 'Night-watch status graph requires one existing Issue number');
  }
  if (!Array.isArray(input.requirements) || !Array.isArray(input.gates)) {
    throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Night-watch status graph requires requirements and gates');
  }
  if (input.issueInstances !== undefined || input.testCases !== undefined) {
    return renderTriadStatusGraph(input);
  }
  const attachments = input.evidenceAttachments === undefined ? null : input.evidenceAttachments;
  if (attachments !== null && !Array.isArray(attachments)) throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Evidence attachments must be an array');
  const attachmentById = new Map((attachments ?? []).map((attachment) => [attachment.id, attachment]));
  const effectiveStatuses = new Map();
  const evidenceStatus = (node) => {
    if (attachments === null) return node.status;
    if (!Array.isArray(node.evidenceRefs) || node.evidenceRefs.length === 0) return 'revalidation-required';
    for (const ref of node.evidenceRefs) {
      const attachment = attachmentById.get(ref);
      const proof = attachment?.provenNodes?.find((entry) => entry.id === node.id)?.proof;
      const stale = !attachment || typeof attachment.runId !== 'string' || typeof attachment.commit !== 'string'
        || typeof attachment.timestamp !== 'string' || typeof attachment.scope !== 'string'
        || attachment.conclusive !== true || attachment.outcome !== 'passed'
        || !proof || (input.expectedCommit && attachment.commit !== input.expectedCommit)
        || (input.evidenceMaxAgeMilliseconds !== undefined && Date.parse(input.now) - Date.parse(attachment.timestamp) > input.evidenceMaxAgeMilliseconds);
      if (stale) return 'revalidation-required';
    }
    return node.status;
  };
  const lines = ['## Night-watch delivery status', '', `- **Issue #${input.issue.number}**: existing delivery anchor`];
  let firstOpenNode = null;
  for (const requirement of input.requirements) {
    requireNode(requirement, 'requirement');
    const requirementStatus = evidenceStatus(requirement);
    effectiveStatuses.set(requirement.id, requirementStatus);
    firstOpenNode ??= openNode('requirement', { ...requirement, status: requirementStatus });
    lines.push(`  - **Requirement ${requirement.id}**: ${requirementStatus}`);
    if (!Array.isArray(requirement.cases)) throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Night-watch requirement cases must be an array');
    for (const testCase of requirement.cases) {
      requireNode(testCase, 'test case');
      const caseStatus = evidenceStatus(testCase);
      effectiveStatuses.set(testCase.id, caseStatus);
      firstOpenNode ??= openNode('test-case', { ...testCase, status: caseStatus });
      lines.push(`    - **Test case ${testCase.id}**: ${caseStatus}`);
      if (attachments !== null) {
        for (const ref of testCase.evidenceRefs ?? []) lines.push(`      - **Evidence ${ref}**: mapped`);
        continue;
      }
      const evidence = testCase.evidence;
      if (!evidence || typeof evidence.id !== 'string' || !evidence.id || !STATUSES.has(evidence.outcome)) {
        throw graphError('NIGHT_WATCH_STATUS_INVALID', 'Night-watch test evidence is invalid');
      }
      firstOpenNode ??= evidence.outcome === 'passed' ? null : { kind: 'evidence', id: evidence.id, status: evidence.outcome };
      lines.push(`      - **Evidence ${evidence.id}**: ${evidence.outcome}`);
    }
  }
  const gates = [];
  for (const gate of input.gates) {
    requireNode(gate, 'delivery gate');
    const status = Array.isArray(gate.required)
      ? aggregateGateStatus(gate.required.map((id) => effectiveStatuses.get(id)), gate.status)
      : gate.status;
    gates.push({ id: gate.id, status });
    firstOpenNode ??= openNode('delivery-gate', { ...gate, status });
    lines.push(`  - **Delivery gate ${gate.id}**: ${status}`);
  }
  return { markdown: `${lines.join('\n')}\n`, firstOpenNode, gates };
}
