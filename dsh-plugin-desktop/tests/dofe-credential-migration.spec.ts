import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import {
  removeLegacyModelCredentials,
  removeModelCredentialEnvironment,
  restrictModelLaunchEnvironment,
} from '../src/dofe-credential-migration.ts'

const homes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-credentials-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('DoFe model credential migration', () => {
  it('removes superseded model credentials and preserves model, search, and unrelated secrets', async () => {
    const home = temporaryHome()
    mkdirSync(home, { recursive: true })
    const path = join(home, '.credentials.yaml')
    writeFileSync(path, [
      'refs:',
      '  MODELS_API_KEY: managed-secret',
      '  DEEPSEEK_API_KEY: old-deepseek-secret',
      '  OPENAI_API_KEY: old-openai-secret',
      '  FEISHU_APP_SECRET: unrelated-secret',
      'records:',
      '  browser-session: preserved-record',
      '',
    ].join('\n'), { mode: 0o644 })

    expect(await removeLegacyModelCredentials(home)).toBe(true)
    const value = parse(readFileSync(path, 'utf8')) as {
      refs: Record<string, string>
      records: Record<string, string>
    }
    expect(value.refs).toEqual({
      MODELS_API_KEY: 'managed-secret',
      DEEPSEEK_API_KEY: 'old-deepseek-secret',
      FEISHU_APP_SECRET: 'unrelated-secret',
    })
    expect(value.records).toEqual({ 'browser-session': 'preserved-record' })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(await removeLegacyModelCredentials(home)).toBe(false)
  })

  it('does nothing when no credentials document exists', async () => {
    expect(await removeLegacyModelCredentials(temporaryHome())).toBe(false)
  })

  it('removes ambient model credentials so installation cannot bypass user input', () => {
    const environment: NodeJS.ProcessEnv = {
      MODELS_API_KEY: 'ambient-managed-key',
      DEEPSEEK_API_KEY: 'ambient-legacy-key',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      OPENAI_API_KEY: 'ambient-openai-key',
      FEISHU_APP_SECRET: 'preserved',
    }

    removeModelCredentialEnvironment(environment)

    expect(environment).toEqual({ FEISHU_APP_SECRET: 'preserved' })
  })

  it('hides model credentials and endpoints from every launch environment layer', () => {
    const environment = restrictModelLaunchEnvironment(createLaunchEnvironmentSnapshot([
      {
        source: 'process',
        values: {
          MODELS_API_KEY: 'ambient-models-key',
          DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
          FEISHU_APP_ID: 'preserved',
        },
      },
      {
        source: 'user-env',
        path: '/home/.dsh/.env',
        values: { DEEPSEEK_API_KEY: 'file-key' },
      },
    ]))

    expect(environment.get('MODELS_API_KEY')).toBeUndefined()
    expect(environment.get('DEEPSEEK_API_KEY')).toBeUndefined()
    expect(environment.get('DEEPSEEK_BASE_URL')).toBeUndefined()
    expect(environment.getFrom('DEEPSEEK_API_KEY', ['user-env'])).toBeUndefined()
    expect(environment.get('FEISHU_APP_ID')).toEqual({ value: 'preserved', source: 'process' })
  })
})
