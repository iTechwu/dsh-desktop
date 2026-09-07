import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { ApiResponseSchema } from '../base';

const c = initContract();

/**
 * OIDC Authorize URL 响应 Schema
 */
export const OidcAuthorizeUrlResponseSchema = z.object({
  url: z.string(),
  state: z.string(),
});

export type OidcAuthorizeUrlResponse = z.infer<typeof OidcAuthorizeUrlResponseSchema>;

/**
 * OIDC Callback 响应 Schema (302 重定向 URL)
 */
export const OidcCallbackResponseSchema = z.object({
  redirectUrl: z.string(),
});

export type OidcCallbackResponse = z.infer<typeof OidcCallbackResponseSchema>;

/**
 * OIDC Logout URL 响应 Schema
 */
export const OidcLogoutUrlResponseSchema = z.object({
  logoutUrl: z.string(),
});

export type OidcLogoutUrlResponse = z.infer<typeof OidcLogoutUrlResponseSchema>;

/**
 * OIDC Exchange Code 请求 Schema
 */
export const OidcExchangeCodeRequestSchema = z.object({
  code: z.string().min(1),
});

/**
 * OIDC Exchange Code 响应 Schema
 * refresh_token 通过 Knowledge 专属 HttpOnly cookie 传递，不在响应体中返回
 */
export const OidcExchangeCodeResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  id_token: z.string().optional(),
  access_expire: z.number(),
  expire: z.number(),
  user: z
    .object({
      id: z.string(),
      code: z.string().nullable(),
      nickname: z.string().nullable(),
      headerImg: z.string().nullable(),
      sex: z.string().nullable(),
      isAnonymity: z.boolean(),
      isAdmin: z.boolean(),
      email: z.string().optional(),
    })
    .optional(),
});

export type OidcExchangeCodeResponse = z.infer<typeof OidcExchangeCodeResponseSchema>;

/**
 * OIDC Refresh Token 响应 Schema
 * refresh_token 始终通过 Knowledge 专属 HttpOnly cookie 续写，不返回给前端。
 */
export const OidcRefreshTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  access_expire: z.number(),
  expire: z.number(),
  user: OidcExchangeCodeResponseSchema.shape.user,
});

export type OidcRefreshTokenResponse = z.infer<typeof OidcRefreshTokenResponseSchema>;

/**
 * OIDC 认证 Contract
 */
export const oidcAuthContract = c.router({
  /**
   * 获取 SSO 授权 URL
   * GET /auth/oidc/authorize
   */
  getAuthorizeUrl: {
    method: 'GET',
    path: '/auth/oidc/authorize',
    query: z.object({
      redirect_uri: z.string().optional(),
    }),
    responses: {
      200: ApiResponseSchema(OidcAuthorizeUrlResponseSchema),
    },
    summary: '获取 SSO OIDC 授权 URL',
  },

  /**
   * 一次性授权码换取 Token
   * POST /auth/oidc/exchange
   */
  exchangeCode: {
    method: 'POST',
    path: '/auth/oidc/exchange',
    body: OidcExchangeCodeRequestSchema,
    responses: {
      200: ApiResponseSchema(OidcExchangeCodeResponseSchema),
    },
    summary: '用一次性授权码换取 SSO Token',
  },

  /**
   * 获取 SSO 退出登录 URL（旧接口，保持向后兼容）
   * GET /auth/oidc/logout
   */
  getLogoutUrl: {
    method: 'GET',
    path: '/auth/oidc/logout',
    query: z.object({
      id_token_hint: z.string().optional(),
    }),
    responses: {
      200: ApiResponseSchema(OidcLogoutUrlResponseSchema),
    },
    summary: '获取 SSO 退出登录 URL',
  },

  /**
   * 安全登出：撤销 access token + 获取 SSO 退出登录 URL
   * POST /auth/oidc/logout
   */
  logout: {
    method: 'POST',
    path: '/auth/oidc/logout',
    body: z.object({
      access_token: z.string(),
      id_token_hint: z.string().optional(),
    }),
    responses: {
      200: ApiResponseSchema(OidcLogoutUrlResponseSchema),
    },
    summary: '撤销 Token 并获取 SSO 退出登录 URL',
  },

  /**
   * 刷新 SSO Token（服务端代理，保护 client_secret）
   * refresh_token 仅从 Knowledge 专属 HttpOnly cookie 读取，不接受请求体传递
   * POST /auth/oidc/token
   */
  refreshToken: {
    method: 'POST',
    path: '/auth/oidc/token',
    body: z.object({}),
    responses: {
      200: ApiResponseSchema(OidcRefreshTokenResponseSchema),
    },
    summary: '通过 SSO 刷新访问令牌',
  },

  /**
   * 清除会话 — 清除 Knowledge 专属 HttpOnly cookie
   * POST /auth/oidc/clear-session
   */
  clearSession: {
    method: 'POST',
    path: '/auth/oidc/clear-session',
    body: z.object({}),
    responses: {
      200: ApiResponseSchema(z.object({ success: z.boolean() })),
    },
    summary: '清除服务端会话 cookie',
  },
});

export type OidcAuthContract = typeof oidcAuthContract;
