/**
 * Enrôlement d'une borne par QR code.
 *
 * Le problème résolu : brancher une borne demandait de saisir au clavier une
 * URL, un identifiant et un jeton de 64 caractères — sur une machine posée
 * debout dans une salle, souvent sans clavier confortable, le soir de
 * l'événement. Le QR fait le même travail en une seconde.
 *
 * ## Ce que le QR transporte, et ce qu'il ne transporte pas
 *
 * Il porte un **mot de passe d'enrôlement**, jamais un jeton. La borne
 * l'échange contre le sien auprès du serveur.
 *
 * La différence compte : un QR s'affiche sur un écran, se photographie de
 * loin, se retrouve dans la pellicule de quelqu'un. Un mot de passe volé
 * rattache une borne de plus — et cette borne-là, on la voit dans la console
 * et on la révoque. Un jeton volé, lui, pilote directement.
 *
 * Il ne porte pas non plus les RÉGLAGES de la borne. Ceux-ci descendent dans la
 * réponse d'enrôlement (`DeviceEnrollResponse.settings`), sur un échange déjà
 * chiffré et déjà autorisé. Deux raisons, dans cet ordre : la clé de régie est
 * un secret et n'a rien à faire dans une image qu'on photographie de loin ; et
 * un QR chargé de trente réglages devient trop dense pour une webcam.
 *
 * ## Format
 *
 * ```json
 * {"v":3,"t":"kiosk-config","u":"https://kiosk.exemple.fr","p":"<mot de passe>","g":"<cible|absent>","s":"hub"}
 * ```
 */

/** Marqueur de type. Ce qui distingue ce QR d'un badge de participant. */
export const DEVICE_CONFIG_QR_TYPE = 'kiosk-config';

/** Version du format produite par `encodeDeviceConfigQr`. */
export const DEVICE_CONFIG_QR_VERSION = 3;

/**
 * Versions qu'une borne à jour sait encore lire.
 *
 * La v2 est conservée parce que les deux serveurs ne se déploient pas le même
 * jour : une borne mise à jour doit continuer de s'enrôler sur une instance
 * `play` qui émet encore l'ancien format. Une v2 ne portant pas d'indice de
 * serveur, elle est lue comme `play` — ce qui était, de fait, le seul serveur
 * qu'une borne savait joindre à l'époque de ce format.
 */
export const DEVICE_CONFIG_QR_READABLE_VERSIONS: readonly number[] = [2, 3];

/**
 * Nature du serveur, et donc forme de ses routes.
 *
 * Les deux serveurs parlent le même protocole — mêmes messages, même régime de
 * jetons — mais ne les exposent pas aux mêmes URL : `play` range tout sous
 * `/api/sessions/:id/…`, `kiosk-hub` sous `/api/v1/…`. La borne ne peut pas le
 * deviner, et sonder les deux formes à l'aveugle consommerait un essai du
 * compteur anti-force-brute à chaque enrôlement. Le serveur le DIT donc, dans
 * le QR qu'il fabrique lui-même.
 */
export type ServerKind = 'play' | 'hub';

/** Ce que la borne suppose face à un QR qui ne dit rien — c'est-à-dire une v2. */
export const DEFAULT_SERVER_KIND: ServerKind = 'play';

const SERVER_KINDS: readonly ServerKind[] = ['play', 'hub'];

export interface DeviceConfigQr {
  /** URL du serveur, sans barre oblique finale. */
  serverUrl: string;
  /** Mot de passe d'enrôlement, à échanger contre le jeton de la borne. */
  password: string;
  /**
   * Cible du rattachement — campagne ou session — quand le serveur en a
   * plusieurs et ne peut pas la déduire du seul mot de passe.
   *
   * Facultatif, et c'est délibéré. Un registre durable a peu de campagnes, aux
   * mots de passe distincts : il résout sans cible et l'opérateur a un QR de
   * moins à ne pas confondre. Un serveur de soirées crée des sessions à la
   * chaîne, dont les mots de passe peuvent se répéter d'un soir à l'autre :
   * il renseigne la cible, sans quoi une borne rejoindrait la session de la
   * semaine dernière.
   */
  target?: string | null;
  /** Forme des routes du serveur. Absent à l'encodage = `play`. */
  serverKind?: ServerKind;
}

interface RawDeviceConfigQr {
  v: number;
  t: string;
  u: string;
  p: string;
  g?: string;
  s?: string;
}

/** QR de configuration d'une version que cette borne ne sait pas lire. */
export class DeviceConfigQrVersionError extends Error {
  constructor(readonly version: number) {
    super(
      `QR de configuration en version ${version} — cette borne lit les versions ${DEVICE_CONFIG_QR_READABLE_VERSIONS.join(' et ')}.`,
    );
    this.name = 'DeviceConfigQrVersionError';
  }
}

/**
 * QR désignant un serveur dont cette borne ne connaît pas les routes.
 *
 * Distinct du refus de version : le format est lisible, c'est la destination
 * qui est inconnue. Retomber silencieusement sur `play` enverrait la borne
 * frapper des URL inexistantes, et l'opérateur chercherait une panne de réseau
 * devant un 404 qui ne dit rien.
 */
export class DeviceConfigQrServerKindError extends Error {
  constructor(readonly serverKind: string) {
    super(`Ce QR désigne un serveur de type « ${serverKind} » — mettez la borne à jour.`);
    this.name = 'DeviceConfigQrServerKindError';
  }
}

/** Encode la charge utile à mettre dans le QR. */
export function encodeDeviceConfigQr(input: DeviceConfigQr): string {
  const payload: RawDeviceConfigQr = {
    v: DEVICE_CONFIG_QR_VERSION,
    t: DEVICE_CONFIG_QR_TYPE,
    u: String(input.serverUrl || '').trim().replace(/\/+$/, ''),
    p: String(input.password || ''),
  };
  const target = String(input.target || '').trim();
  if (target) payload.g = target;
  // Toujours écrit, y compris pour `play` : le format v3 se lit alors sans
  // dépendre d'une valeur par défaut, et un QR imprimé reste explicite le jour
  // où on le relit six mois plus tard pour comprendre où pointait une borne.
  payload.s = input.serverKind && SERVER_KINDS.includes(input.serverKind)
    ? input.serverKind
    : DEFAULT_SERVER_KIND;
  return JSON.stringify(payload);
}

/**
 * Lit un QR de configuration, ou rend `null` si ce n'en est pas un.
 *
 * Ne jette que sur une version inconnue ou un serveur inconnu — même raison que
 * pour les badges : la borne passe ici le contenu de tout QR décodé, et un
 * badge de participant ne doit pas remonter comme une erreur.
 */
export function parseDeviceConfigQr(raw: unknown): DeviceConfigQr | null {
  const value = String(raw ?? '').trim();
  if (!value.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const row = parsed as Partial<RawDeviceConfigQr>;
  if (row.t !== DEVICE_CONFIG_QR_TYPE) return null;
  if (!DEVICE_CONFIG_QR_READABLE_VERSIONS.includes(Number(row.v))) {
    throw new DeviceConfigQrVersionError(Number(row.v) || 0);
  }

  const serverUrl = String(row.u || '').trim().replace(/\/+$/, '');
  const password = String(row.p || '');
  if (!serverUrl || !password) return null;
  if (!/^https?:\/\//i.test(serverUrl)) return null;

  // Un `s` absent est le cas NORMAL d'une v2, pas une anomalie : seul un `s`
  // renseigné et inconnu justifie de refuser.
  const rawKind = String(row.s || '').trim();
  if (rawKind && !SERVER_KINDS.includes(rawKind as ServerKind)) {
    throw new DeviceConfigQrServerKindError(rawKind);
  }
  const serverKind = (rawKind || DEFAULT_SERVER_KIND) as ServerKind;

  const target = String(row.g || '').trim();
  return { serverUrl, password, target: target || null, serverKind };
}

/**
 * Réglages qu'un serveur a le droit de poser sur une borne à l'enrôlement.
 *
 * C'est ce qui permet d'installer une borne à la caméra seule : sans cette
 * liste, l'enrôlement ne câblait que la liaison au serveur et il fallait
 * encore ouvrir le configurateur au clavier pour les durées, les gestes ou la
 * clé de régie.
 *
 * **Deux réglages en sont volontairement absents**, parce qu'ils décrivent la
 * MACHINE et non l'événement :
 *
 *   `KIOSK_RECORDINGS_DIR`  un chemin qui n'existe pas sur le PC casserait
 *                           l'enregistrement, et le serveur ne peut pas savoir
 *                           quels disques sont montés dans la salle ;
 *   `KIOSK_NAME`            poussé à l'identique sur cinq bornes, il les rendrait
 *                           indistinguables dans la console — exactement le
 *                           problème qu'il sert à résoudre.
 *
 * Les clés `GAME_*` n'y figurent pas non plus : elles sont le RÉSULTAT de
 * l'enrôlement, pas un réglage à transmettre.
 *
 * La borne revalide chaque valeur avec son propre schéma avant de l'écrire.
 * Cette liste sert aux serveurs, pour refuser en console ce qu'ils ne
 * pourraient de toute façon pas faire appliquer.
 */
export const DEVICE_SETTING_KEYS: readonly string[] = [
  'KIOSK_MODE_ACTIVE',
  'KIOSK_UPLOAD_ACTIVE',
  'KIOSK_MAX_DURATION',
  'KIOSK_MIN_DURATION',
  'KIOSK_VIDEO_BITRATE',
  'KIOSK_ENABLE_FACE_DETECTION',
  'KIOSK_IDLE_TIMEOUT',
  'KIOSK_ENABLE_HAND_TRACKING',
  'KIOSK_END_GESTURES',
  'KIOSK_GESTURE_HOLD_MS',
  'KIOSK_ENABLE_TRACKING_DOT',
  'KIOSK_ADMIN_PORT',
  'KIOSK_ADMIN_KEY',
  'KIOSK_TRANSCODE',
  'KIOSK_TRANSCODE_PRESET',
  'KIOSK_TRANSCODE_CRF',
];

/**
 * Profil de borne tel qu'il circule : des chaînes, comme dans un `.env`.
 *
 * Les valeurs ne sont pas typées ici exprès. Le seul schéma qui fasse autorité
 * est celui de la borne — c'est elle qui connaît ses bornes de validité — et un
 * second typage côté serveur divergerait à la première évolution.
 */
export type DeviceSettings = Record<string, string>;

/** Ne garde d'un profil que les clés qu'une borne acceptera. */
export function pickDeviceSettings(input: unknown): DeviceSettings {
  if (!input || typeof input !== 'object') return {};
  const out: DeviceSettings = {};
  for (const key of DEVICE_SETTING_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'boolean' ? String(value) : String(value);
  }
  return out;
}

/** Corps de l'appel d'enrôlement. */
export interface DeviceEnrollRequest {
  password: string;
  target?: string | null;
  /** Identité stable de la borne, pour que le serveur la reconnaisse ensuite. */
  deviceId?: string;
  /** Nom lisible proposé par la borne. */
  name?: string;
}

/** Réponse d'un enrôlement accepté. */
export interface DeviceEnrollResponse {
  deviceId: string;
  /**
   * Jeton propre à CETTE borne — c'est ce qu'elle enregistre.
   *
   * Il ne donne accès qu'à sa propre socket et à ses propres dépôts vidéo.
   * Il ne permet ni de piloter les autres bornes, ni de lire l'annuaire.
   */
  deviceToken: string;
  /** Libellé de la campagne ou de la session, pour l'afficher en confirmation. */
  contextLabel?: string;
  /**
   * Réglages à appliquer sur cette borne, restreints à `DEVICE_SETTING_KEYS`.
   *
   * Facultatif : un serveur qui n'en propose pas laisse la borne sur ses
   * propres réglages, ce qui est le comportement d'avant cette clé.
   */
  settings?: DeviceSettings;
}

/** Corps de l'appel d'identification d'un badge — mode `resolve` uniquement. */
export interface ResolveBadgeRequest {
  code: string;
}

export interface ResolveBadgeResponse {
  participantId: string;
  displayName: string;
  /** `false` : connu, mais pas autorisé sur cette borne (mode ciblé, liste). */
  allowed: boolean;
  /** Motif à afficher quand `allowed` est faux. */
  reason?: string;
}
