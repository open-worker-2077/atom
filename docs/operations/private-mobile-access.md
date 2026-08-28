# Atom 私网手机入口

## 定位

手机与电脑操作同一台主机上的 Atom；电脑仍是唯一事实源和备份责任方。入口只存在于 Tailscale 私网，不开放路由器端口，不使用 Funnel，不复制 `atom.json`。

## 启用

1. 电脑和 Android 手机安装 Tailscale，并登录同一私人网络。
2. 电脑端确认 `http://127.0.0.1:4784/` 正常。
3. 在仓库根目录运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/install-atom-private-access.ps1
   ```

安装器只接受当前 Tailscale 登录身份，拒绝覆盖既有 Serve 配置或同名计划任务，并在失败时撤回本次创建的入口。

安装器同时登记 `Atom Graph Runtime` 监督任务，并把身份网关任务配置为长期运行：允许电池供电、取消三天执行上限，异常退出后每分钟自动重启。重复运行安装器会修复 Atom 自己拥有的既有任务，不会覆盖其他计划任务或 Serve 配置。

主入口依赖 Android MagicDNS。若真机的域名链持续中断，可另启 Tailnet IP 直连网关：它只绑定电脑的 Tailscale IPv4，并只接受显式批准的手机 Tailscale IPv4；手机使用 `http://<电脑的 Tailscale IPv4>:<直连端口>/`。传输仍在 Tailscale 加密私网内，不经过公网。

## 停用

```powershell
powershell -ExecutionPolicy Bypass -File scripts/disable-atom-private-access.ps1
```

停用只移除 Atom 自己登记的 HTTPS 映射、身份网关和计划任务，不重置其他 Tailscale 配置，也不修改 Atom 数据。
本地 `Atom Graph Runtime` 监督任务继续保留，使电脑端 `127.0.0.1:4784` 不因停用手机入口而失效。

## 安全边界

- 4784 继续只监听 `127.0.0.1`。
- 4785 继续只监听 `127.0.0.1`，并要求 Tailscale Serve 注入且位于白名单的登录身份。
- 直连网关不得绑定 `0.0.0.0`、局域网地址或公网地址；非批准手机来源即使伪造身份头也必须拒绝。
- 失去 Tailscale 身份、身份不匹配或误用 Funnel 时均拒绝访问。
- Android 端不保存第二份事实副本；断网时停止写入，恢复连接后继续使用电脑端事实。
