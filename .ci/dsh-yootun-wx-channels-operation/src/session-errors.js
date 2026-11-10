// 会话失效确定性错误：解析层在官方明确返回登录失效形态时抛出，runner 捕获后
// 标记会话 expired 并走过期收尾（保留已采集数据，不覆盖为空白，§8.4/§9.5）。

export class SessionInvalidError extends Error {
  constructor(reason = 'session_invalid') {
    super(`wx_channels_session_invalid: ${reason}`)
    this.name = 'SessionInvalidError'
    this.code = 'WX_SESSION_INVALID'
    this.reason = reason.slice(0, 64)
  }
}
