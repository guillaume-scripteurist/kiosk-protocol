/**
 * Badge d'un participant : ce que la borne lit dans son QR code.
 *
 * ## Pourquoi une signature
 *
 * En v1, la borne connaissait tout l'annuaire : elle le téléchargeait toutes
 * les quatre secondes et vérifiait le badge en mémoire. Deux problèmes, chacun
 * suffisant à lui seul :
 *
 *   - un registre durable compte des milliers d'inscrits, et on ne télécharge
 *     pas un annuaire de plusieurs milliers de lignes toutes les 4 secondes ;
 *   - pour l'obtenir, la borne devait détenir un jeton donnant accès à cet
 *     annuaire — donc à l'identité de tous les participants — sur une machine
 *     posée dans une salle.
 *
 * Un badge signé règle les deux : la borne ne connaît personne, et vérifie
 * quand même. Elle n'a besoin que du secret de sa campagne, reçu à
 * l'enrôlement, et **d'aucun réseau**. Une coupure wifi n'empêche plus
 * personne de passer devant l'objectif.
 *
 * ## Ce que la signature ne fait pas
 *
 * Elle authentifie le badge, pas la personne. Quelqu'un qui photographie le QR
 * d'un autre peut se présenter à sa place — comme avec un badge en carton. La
 * parade est ailleurs : la durée de validité, et le fait qu'une vidéo mal
 * attribuée se corrige depuis la console.
 *
 * ## Format
 *
 * JSON compact — le nombre de modules d'un QR croît vite avec la longueur, et
 * un QR trop dense ne se lit plus à cinquante centimètres avec une webcam.
 *
 * ```json
 * {"v":2,"t":"badge","c":"<code>","e":<expiration|0>,"s":"<signature>"}
 * ```
 */

/** Marqueur de type. Ce qui distingue ce QR d'un QR de configuration. */
export const BADGE_QR_TYPE = 'badge';

/** Version du format. Une borne plus ancienne refuse proprement une v3. */
export const BADGE_QR_VERSION = 2;

export interface Badge {
  /** Code du participant — court et dictable, celui qu'on lit à voix haute. */
  code: string;
  /** Millisecondes epoch. `null` = ne périme pas. */
  expiresAt: number | null;
}

interface RawBadge {
  v: number;
  t: string;
  c: string;
  e: number;
  s?: string;
}

/** Badge d'une version que cette borne ne sait pas lire. */
export class BadgeVersionError extends Error {
  constructor(readonly version: number) {
    super(`Badge en version ${version} — cette borne lit la version ${BADGE_QR_VERSION}.`);
    this.name = 'BadgeVersionError';
  }
}

/**
 * Lit un badge SANS vérifier sa signature, ou rend `null` si ce n'en est pas un.
 *
 * **Ne jette jamais**, sauf sur une version inconnue. La borne passe ici le
 * contenu de TOUT QR décodé — menu de restaurant, ticket de caisse, badge d'un
 * autre système. Une exception ferait tomber le scan pour tout le monde.
 *
 * Une version inconnue est en revanche un refus EXPLICITE : la borne doit
 * pouvoir dire « ce badge vient d'un serveur plus récent, mettez-moi à jour »
 * plutôt qu'afficher « badge non reconnu » à quelqu'un qui présente exactement
 * le bon.
 *
 * C'est aussi la seule lecture nécessaire en mode `resolve`, où la signature
 * n'existe pas et où c'est le serveur qui identifie la personne.
 */
export function parseBadge(raw: unknown): (Badge & { signature: string | null }) | null {
  const value = String(raw ?? '').trim();
  // Écarté sans même tenter un parse : `JSON.parse` sur chaque image scannée
  // est un coût inutile sur un thread qui décode déjà dix images par seconde.
  if (!value.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const row = parsed as Partial<RawBadge>;
  if (row.t !== BADGE_QR_TYPE) return null;
  if (row.v !== BADGE_QR_VERSION) throw new BadgeVersionError(Number(row.v) || 0);

  const code = String(row.c || '').trim();
  if (!code) return null;

  const expiry = Number(row.e) || 0;
  return {
    code,
    expiresAt: expiry > 0 ? expiry : null,
    signature: typeof row.s === 'string' && row.s ? row.s : null,
  };
}

/** Charge utile signée. Ordre des champs fixe : la signature porte sur ce texte. */
function signedPayload(badge: Badge): string {
  return `${BADGE_QR_VERSION}.${badge.code}.${badge.expiresAt ?? 0}`;
}

async function hmac(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64url(new Uint8Array(signature));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // `btoa` existe dans Node ≥ 16 comme dans tout navigateur : rien à importer.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Comparaison à temps constant.
 *
 * Une comparaison de chaînes s'arrête au premier caractère différent : le
 * temps de réponse dit alors combien de caractères étaient bons, et une
 * signature se reconstitue octet par octet. La borne répond des milliers de
 * fois par soirée à qui veut lui présenter un QR.
 */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fabrique le contenu du QR d'un participant. Serveur uniquement. */
export async function signBadge(badge: Badge, secret: string): Promise<string> {
  if (!secret) throw new Error('Secret de badge manquant.');
  const code = String(badge.code || '').trim();
  if (!code) throw new Error('Code de participant manquant.');
  const normalised: Badge = { code, expiresAt: badge.expiresAt ?? null };
  const raw: RawBadge = {
    v: BADGE_QR_VERSION,
    t: BADGE_QR_TYPE,
    c: normalised.code,
    e: normalised.expiresAt ?? 0,
    s: await hmac(secret, signedPayload(normalised)),
  };
  return JSON.stringify(raw);
}

/** Motif d'un badge refusé, ou `null` s'il est valable. */
export type BadgeRejection = 'malformed' | 'unsigned' | 'bad-signature' | 'expired';

export interface BadgeVerdict {
  badge: Badge | null;
  rejection: BadgeRejection | null;
}

/**
 * Vérifie un badge hors ligne, avec le secret reçu à l'enrôlement.
 *
 * Rend le MOTIF du refus et pas un simple `false` : le message s'affiche sur
 * une borne posée dans une salle, souvent loin de qui pourrait diagnostiquer.
 * « Badge périmé » et « badge d'une autre campagne » n'appellent pas le même
 * geste, et les confondre envoie chercher au mauvais endroit.
 */
export async function verifyBadge(
  raw: unknown,
  secret: string,
  now: number = Date.now(),
): Promise<BadgeVerdict> {
  const parsed = parseBadge(raw);
  if (!parsed) return { badge: null, rejection: 'malformed' };
  if (!parsed.signature) return { badge: null, rejection: 'unsigned' };

  const badge: Badge = { code: parsed.code, expiresAt: parsed.expiresAt };
  const expected = await hmac(secret, signedPayload(badge));
  if (!equalConstantTime(expected, parsed.signature)) {
    return { badge: null, rejection: 'bad-signature' };
  }
  // L'expiration est vérifiée APRÈS la signature : sans quoi la borne
  // renseignerait sur la validité d'un badge fabriqué de toutes pièces.
  if (badge.expiresAt !== null && badge.expiresAt <= now) {
    return { badge: null, rejection: 'expired' };
  }
  return { badge, rejection: null };
}
