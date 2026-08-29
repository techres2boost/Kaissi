import { describe, expect, it } from 'vitest'
import { configurationPg, hoteDe, ErreurConfiguration } from '../src/connexion.js'

const URL_SUPABASE =
  'postgresql://postgres.mzrbpbqp:MOT2PASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'

describe('configurationPg', () => {
  it('laisse `pg` analyser l’URL quand aucun mot de passe séparé n’est donné', () => {
    const c = configurationPg({ DATABASE_URL: URL_SUPABASE })
    expect(c.connectionString).toBe(URL_SUPABASE)
    expect(c.password).toBeUndefined()
  })

  it('écarte COMPLÈTEMENT connectionString dès qu’un mot de passe est donné', () => {
    // `pg` ré-analyse toujours connectionString et écrase le mot de passe
    // passé à côté. Le laisser traîner rendrait DATABASE_PASSWORD inopérant
    // — et sans erreur : juste une authentification qui échoue.
    const c = configurationPg({ DATABASE_URL: URL_SUPABASE, DATABASE_PASSWORD: 'x' })
    expect(c.connectionString).toBeUndefined()
    expect(c.host).toBe('aws-0-eu-central-1.pooler.supabase.com')
    expect(c.port).toBe(5432)
    expect(c.database).toBe('postgres')
    expect(c.user).toBe('postgres.mzrbpbqp')
  })

  it('transmet le mot de passe TEL QUEL, sans encodage', () => {
    // Le cœur du problème : ces caractères cassent une URL, et les encoder
    // à la main est la source d'erreur la plus fréquente. Ici ils passent
    // intacts, parce qu'ils ne traversent aucune URL.
    for (const brut of [
      'Kaissi2026Res2boost!',
      'a?b#c/d%e@f:g h',
      '100%sûr',
      'avec"guillemets\'et\\antislash',
    ]) {
      expect(configurationPg({ DATABASE_URL: URL_SUPABASE, DATABASE_PASSWORD: brut }).password).toBe(
        brut,
      )
    }
  })

  it('ignore un DATABASE_PASSWORD vide plutôt que d’envoyer un mot de passe vide', () => {
    const c = configurationPg({ DATABASE_URL: URL_SUPABASE, DATABASE_PASSWORD: '' })
    expect(c.connectionString).toBe(URL_SUPABASE)
  })

  it('décode l’utilisateur percent-encodé de l’URL', () => {
    const c = configurationPg({
      DATABASE_URL: 'postgresql://mon%40user:p@h.example:5432/base',
      DATABASE_PASSWORD: 'x',
    })
    expect(c.user).toBe('mon@user')
    expect(c.database).toBe('base')
  })

  it('exige DATABASE_URL, et refuse une URL illisible', () => {
    expect(() => configurationPg({})).toThrow(ErreurConfiguration)
    expect(() =>
      configurationPg({ DATABASE_URL: 'pas une url', DATABASE_PASSWORD: 'x' }),
    ).toThrow(ErreurConfiguration)
  })

  it('nomme l’hôte pour les messages, dans les deux formes', () => {
    expect(hoteDe(configurationPg({ DATABASE_URL: URL_SUPABASE }))).toBe(
      'aws-0-eu-central-1.pooler.supabase.com',
    )
    expect(
      hoteDe(configurationPg({ DATABASE_URL: URL_SUPABASE, DATABASE_PASSWORD: 'x' })),
    ).toBe('aws-0-eu-central-1.pooler.supabase.com')
  })
})
