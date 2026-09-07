import { z } from 'zod';

/**
 * SSO session compatibility schemas.
 *
 * Local sign-in/register/refresh request schemas were removed because
 * sso.dofe.ai is the only authentication source of truth. The remaining
 * response schemas are shared by the OIDC token manager and profile APIs.
 */

export const PlanSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  duration: z.number(),
});
export type Plan = z.infer<typeof PlanSchema>;

/**
 * 用户基本信息
 */
export const UserInfoSchema = z.object({
  id: z.string(),
  isAnonymity: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  code: z.string().nullable(),
  nickname: z.string().nullable(),
  headerImg: z.string().nullable(),
  sex: z.string().nullable(),
  /** 手机号（已脱敏） */
  mobile: z.string().nullable().optional(),
  /** 邮箱（已脱敏） */
  email: z.string().nullable().optional(),
  /** SSO subject（本地用户映射缓存字段） */
  ssoSub: z.string().nullable().optional(),
});
export type UserInfo = z.infer<typeof UserInfoSchema>;

/**
 * OIDC 登录/刷新成功响应兼容结构。
 *
 * refresh 已废弃：SSO refresh_token 只允许保存在 dofe_rf HttpOnly cookie。
 */
export const LoginSuccessSchema = z.object({
  access: z.string(),
  refresh: z.string().optional(),
  expire: z.number(),
  accessExpire: z.number(),
  isAnonymity: z.boolean().optional(),
  user: UserInfoSchema,
});
export type LoginSuccess = z.infer<typeof LoginSuccessSchema>;

/**
 * 登出成功响应
 */
export const SignOutSuccessSchema = z.object({
  success: z.boolean(),
});
export type SignOutSuccess = z.infer<typeof SignOutSuccessSchema>;
