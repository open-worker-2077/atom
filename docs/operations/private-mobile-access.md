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

## 停用

```powershell
powershell -ExecutionPolicy Bypass -File scripts/disable-atom-private-access.ps1
```

停用只移除 Atom 自己登记的 HTTPS 映射、身份网关和计划任务，不重置其他 Tailscale 配置，也不修改 Atom 数据。

## 安全边界

- 4784 继续只监听 `127.0.0.1`。
- 4785 继续只监听 `127.0.0.1`，并要求 Tailscale Serve 注入且位于白名单的登录身份。
- 失去 Tailscale 身份、身份不匹配或误用 Funnel 时均拒绝访问。
- Android 端不保存第二份事实副本；断网时停止写入，恢复连接后继续使用电脑端事实。
