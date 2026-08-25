/**
 * Consignes de régie : ce qu'une application pilote peut demander à une borne.
 *
 * Le normaliseur est appelé aux DEUX bouts — côté serveur pour qu'une faute de
 * frappe dans la console ne parte pas sur cinq bornes n'y produire que des
 * refus silencieux ; côté borne pour qu'une consigne malformée soit refusée
 * avec un message plutôt qu'appliquée à moitié.
 *
 * Deux familles :
 *
 *   CONSOLE  — déclenchées par un humain. Elles passent par
 *              {@link normalizeDeviceCommand}.
 *   SERVEUR  — poussées par le serveur de son propre chef (synchronisation de
 *              la banque de questions). Elles ne viennent d'aucune saisie.
 */

/** Consignes qu'une console peut émettre. */
export const DEVICE_ACTIONS = [
  'mode',
  'flash',
  'start',
  'stop',
  'abort',
  'duration',
  'category',
  'welcome',
  'allow',
  'sequence',
  'question:next',
  // Ne sert qu'à retirer une question LOCALE d'une borne — celle qu'aucune
  // playlist n'attend, et que la console signale.
  'question:delete',
  'questionMode',
  'refresh',
  // Fait clignoter l'écran de la borne visée.
  //
  // Nouveau en v2, et pas un gadget : la console liste « Borne 1, Borne 2,
  // Borne 3 » et personne ne sait laquelle est celle du fond de la salle. On
  // renommait à l'aveugle, ou on allait débrancher pour voir laquelle tombait.
  'identify',
] as const;

export type DeviceAction = (typeof DEVICE_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(DEVICE_ACTIONS);

/**
 * Consignes poussées par le serveur, hors de toute saisie humaine.
 *
 * `questions:sync` descend la banque de questions. Elle n'est pas dans
 * {@link DEVICE_ACTIONS} exprès : l'exposer à la console laisserait deux bornes
 * finir la soirée avec deux banques différentes.
 */
export const DEVICE_SERVER_ACTIONS = ['questions:sync'] as const;

export type DeviceServerAction = (typeof DEVICE_SERVER_ACTIONS)[number];

/** Modes d'accès d'une borne. */
export type DeviceMode = 'open' | 'targeted' | 'allowlist' | 'closed';

/**
 * Un participant désigné.
 *
 * Le nom voyage À CÔTÉ de l'identifiant, et pas seulement l'identifiant : la
 * borne doit pouvoir afficher « Réservé à Marie, Paul et Léa » sur son écran,
 * et elle n'a pas toujours de quoi résoudre un identifiant sous la main —
 * poste hors ligne, serveur injoignable. C'est aussi le seul recours quand le
 * badge scanné ne porte pas d'identifiant exploitable.
 */
export interface ParticipantRef {
  id: string | null;
  displayName: string | null;
}

export type DeviceCommand =
  | { action: 'mode'; mode: DeviceMode; target: ParticipantRef | null; allowed: ParticipantRef[] | null }
  | { action: 'welcome'; title: string; subtitle: string }
  | { action: 'allow'; allowed: ParticipantRef[] }
  | { action: 'flash'; message: string; level: 'info' | 'warn' | 'error' }
  | { action: 'start'; participant: ParticipantRef; question: string | null }
  | { action: 'stop' }
  | { action: 'abort'; reason: string | null }
  | { action: 'duration'; seconds: number }
  | { action: 'category'; category: string | null }
  | { action: 'questionMode'; mode: 'random' | 'sequence' }
  | { action: 'sequence'; ids: string[] }
  | { action: 'question:next'; text: string | null; playlistId: string | null }
  | { action: 'question:delete'; id: string }
  | { action: 'refresh' }
  | { action: 'identify'; seconds: number };

/** Durée d'une réponse, en secondes. Bornes communes à la borne et à la console. */
export function deviceDuration(value: unknown): number {
  const n = Number(value) || 0;
  return Math.min(600, Math.max(5, n));
}

/** Texte borné et débarrassé de ses espaces de garde. */
function text(value: unknown, max: number): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * Lit un participant désigné sous ses deux formes : à plat comme l'envoie la
 * console (`{id, displayName}` à la racine), ou groupé comme le rend cette
 * fonction (`{target}` / `{participant}`).
 */
function participantRef(input: Record<string, unknown>, nested: 'target' | 'participant'): ParticipantRef {
  const group = (input[nested] || {}) as Record<string, unknown>;
  return {
    id: text(input.id ?? group.id, 64) || null,
    displayName: text(input.displayName ?? group.displayName, 60) || null,
  };
}

/** Liste des participants autorisés à laisser un message sur une borne. */
export function normalizeParticipantList(input: unknown): ParticipantRef[] {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: ParticipantRef[] = [];
  for (const row of rows.slice(0, 200)) {
    const record = (row ?? {}) as Record<string, unknown>;
    const id = text(record.id, 64);
    const displayName = text(record.displayName ?? row, 60);
    if (!id && !displayName) continue;
    const key = id || displayName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: id || null, displayName: displayName || null });
  }
  return out;
}

/**
 * Valide et met en forme une consigne avant de la pousser sur une borne.
 *
 * **Idempotent** — et il doit le rester. La console envoie le participant à
 * plat (`{id, displayName}`), la sortie le range sous `target` / `participant` ;
 * la borne repasse cette sortie dans la même fonction. Sans accepter les deux
 * formes, ce second passage effacerait le participant désigné et la borne
 * attendrait « quelqu'un » sans savoir qui — au moment précis où plus personne
 * ne peut le constater. Même raison pour `playlistId`, que le serveur résout
 * APRÈS normalisation : le perdre enverrait la vidéo sans rangement.
 *
 * @throws {Error} message destiné à être affiché tel quel à l'organisateur
 */
export function normalizeDeviceCommand(body: unknown): DeviceCommand {
  const source = (body ?? {}) as Record<string, unknown>;
  const action = String(source.action || '').trim();
  if (!ACTION_SET.has(action)) throw new Error(`Consigne inconnue : ${action || '(vide)'}`);
  const input = (source.payload || {}) as Record<string, unknown>;

  switch (action as DeviceAction) {
    case 'mode': {
      const wanted = String(input.mode || '');
      const mode = (['open', 'targeted', 'allowlist', 'closed'] as const).find(m => m === wanted);
      if (!mode) throw new Error('Mode attendu : open, targeted, allowlist ou closed.');
      const target = mode === 'targeted' ? participantRef(input, 'target') : null;
      if (mode === 'targeted' && target && !target.id && !target.displayName) {
        throw new Error('Le mode confessionnal exige un participant.');
      }
      // Le mode « liste » embarque sa liste : la borne ne doit pas se retrouver
      // à filtrer sur une liste vide, ce qui reviendrait à fermer sans le dire.
      const allowed = mode === 'allowlist' ? normalizeParticipantList(input.allowed) : null;
      if (mode === 'allowlist' && (!allowed || !allowed.length)) {
        throw new Error('Sélectionnez au moins un participant autorisé.');
      }
      return { action: 'mode', mode, target, allowed };
    }

    /**
     * Message d'accueil affiché sur la borne au repos. Deux lignes distinctes :
     * le titre se lit à cinq mètres, le sous-titre explique le geste à faire.
     */
    case 'welcome':
      return { action: 'welcome', title: text(input.title, 120), subtitle: text(input.subtitle, 200) };

    /**
     * Filtre des participants autorisés, sans changer le mode. Une liste vide
     * rouvre la borne à tout le monde — c'est le geste inverse, et il doit
     * rester possible sans passer par le menu des modes.
     */
    case 'allow':
      return { action: 'allow', allowed: normalizeParticipantList(input.allowed) };

    case 'flash': {
      const message = text(input.message, 160);
      if (!message) throw new Error('Message vide.');
      const level = (['info', 'warn', 'error'] as const).find(l => l === input.level) || 'info';
      return { action: 'flash', message, level };
    }

    case 'start': {
      const participant = participantRef(input, 'participant');
      if (!participant.id && !participant.displayName) throw new Error('Indiquez un participant.');
      return { action: 'start', participant, question: text(input.question, 400) || null };
    }

    case 'stop':
      return { action: 'stop' };

    case 'abort':
      return { action: 'abort', reason: text(input.reason, 160) || null };

    case 'duration':
      return { action: 'duration', seconds: deviceDuration(input.seconds) };

    case 'category':
      return { action: 'category', category: text(input.category, 40) || null };

    case 'questionMode':
      return { action: 'questionMode', mode: input.mode === 'sequence' ? 'sequence' : 'random' };

    case 'sequence': {
      const ids = (Array.isArray(input.ids) ? input.ids : [])
        .slice(0, 50)
        .map(id => text(id, 64))
        .filter(Boolean);
      return { action: 'sequence', ids };
    }

    /**
     * Question imposée à la prochaine interview. Le texte peut ne pas figurer
     * dans la banque (consigne improvisée) : la playlist est résolue par
     * l'appelant APRÈS cet appel, sinon la vidéo partirait sans rangement —
     * c'est justement le cas où l'on veut la retrouver. On préserve donc une
     * playlist déjà résolue au lieu de la remettre à `null`.
     */
    case 'question:next':
      return {
        action: 'question:next',
        text: text(input.text, 400) || null,
        playlistId: text(input.playlistId, 64) || null,
      };

    case 'question:delete': {
      const id = text(input.id, 64);
      if (!id) throw new Error('Question non identifiée.');
      return { action: 'question:delete', id };
    }

    case 'refresh':
      return { action: 'refresh' };

    /**
     * Durée du clignotement, bornée entre 2 et 60 secondes. Trop court, on
     * rate le signal en traversant la salle ; trop long, une borne clignote
     * encore devant les invités quand on l'a déjà trouvée.
     */
    case 'identify': {
      const n = Number(input.seconds) || 10;
      return { action: 'identify', seconds: Math.min(60, Math.max(2, n)) };
    }
  }

  // Inatteignable : `ACTION_SET` a déjà filtré. Présent pour que TypeScript
  // signale toute action ajoutée à la liste et oubliée dans le switch.
  throw new Error(`Consigne non traitée : ${action}`);
}
