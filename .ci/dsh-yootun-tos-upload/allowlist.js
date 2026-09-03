/**
 * 已选文件允许清单（会话内）。
 * 安全模型：upload 只接受本会话内 pick-file 返回过的路径，
 * 其余一律拒绝；agent 工具不接受模型传入的任意路径（见 tool.js 人机回环）。
 * 校验用 lstat：必须是普通文件、拒绝符号链接、大小不超过上限。
 */

import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { guessContentType } from './mime.js'

/** 允许清单条目最大存活时间（会话内兜底，防无限膨胀）。 */
const MAX_ENTRIES = 256

export class PickedFileStore {
  constructor() {
    /** @type {Map<string, {path:string,name:string,size:number,mime:string,pickedAt:number}>} */
    this.entries = new Map()
  }

  /** 登记一次用户亲手选择的文件。 */
  admit(path, meta) {
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
    const entry = {
      path,
      name: meta?.name ?? basename(path),
      size: meta?.size ?? 0,
      mime: meta?.mime ?? guessContentType(path),
      pickedAt: Date.now(),
    }
    this.entries.set(path, entry)
    return entry
  }

  /** 查询路径是否在允许清单内（不删除，可重复上传同一文件）。 */
  get(path) {
    return this.entries.get(path) ?? null
  }

  clear() {
    this.entries.clear()
  }
}

/**
 * 校验一个待上传路径的实时文件状态（登记/准入时使用）。
 * @param {string} path 待校验路径。
 * @param {object} [options] { maxBytes } 大小上限。
 * @returns {Promise<{ok:true,size:number}|{ok:false,error:string}>}
 */
export async function validateUploadableFile(path, options = {}) {
  const maxBytes = options.maxBytes ?? Infinity
  let info
  try {
    info = await lstat(path)
  } catch {
    return { ok: false, error: 'file_not_found' }
  }
  if (info.isSymbolicLink()) return { ok: false, error: 'symlink_rejected' }
  if (!info.isFile()) return { ok: false, error: 'not_a_regular_file' }
  if (info.size > maxBytes) return { ok: false, error: 'file_too_large' }
  return { ok: true, size: info.size }
}

/**
 * TOCTOU 复查：上传前对“已登记路径”再次校验实时状态。
 *
 * 与 validateUploadableFile 的区别：多一项——文件大小必须与登记时一致；
 * 选择后文件被替换/追加/截断一律返回 file_changed，禁止继续上传。
 * @param {PickedFileStore} store 允许清单。
 * @param {string} path 待上传路径（必须已登记）。
 * @param {object} [options] { maxBytes } 大小上限。
 * @returns {Promise<{ok:true,size:number,entry:object}|{ok:false,error:string}>}
 */
export async function revalidateAdmittedFile(store, path, options = {}) {
  const entry = store.get(path)
  // 未登记路径与不存在文件同等对待：不向调用方解释允许清单语义。
  if (entry === null) return { ok: false, error: 'file_not_found' }
  const check = await validateUploadableFile(path, options)
  if (!check.ok) return check
  if (entry.size > 0 && check.size !== entry.size) return { ok: false, error: 'file_changed' }
  return { ok: true, size: check.size, entry }
}
