/**
 * Consignes de régie : ce qu'une application pilote peut demander à une borne.
 *
 * La normalisation vivait dans `server.js` seul. La borne recevait donc des
 * consignes brutes et faisait confiance : elle appliquait ce qui arrivait, sans
 * pouvoir vérifier que la forme était celle attendue. En sortant le contrat ici,
 * les deux bouts valident la MÊME chose, et une application tierce peut piloter
 * une borne sans avoir à deviner la forme des messages.
 *
 * Deux familles :
 *
 *   CONSOLE  — déclenchées par un humain dans la console vidéo, elles passent
 *              par `POST /api/sessions/:id/kiosks/:kioskId/command` et donc par
 *              {@link normalizeKioskCommand}.
 *   SERVEUR  — poussées par le serveur de son propre chef (synchronisation de
 *              la banque de questions). Elles ne viennent d'aucune saisie et
 *              n'ont rien à normaliser.
 */

/** Consignes qu'une console peut émettre. */
export const KIOSK_ACTIONS = [
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
  // `question:delete` ne sert plus qu'à retirer une question LOCALE d'une borne
  // — celle qu'aucune playlist n'attend, et que la console signale.
  'question:delete',
  'questionMode',
  'refresh',
] as const;

export type KioskAction = (typeof KIOSK_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(KIOSK_ACTIONS);

/**
 * Consignes poussées par le serveur, hors de toute saisie humaine.
 *
 * `questions:sync` descend la banque de questions du compte Streamlike. Elle
 * n'est pas dans {@link KIOSK_ACTIONS} exprès : l'exposer à la console
 * laisserait deux bornes finir la soirée avec deux banques différentes.
 */
export const KIOSK_SERVER_ACTIONS = ['questions:sync'] as const;

export type KioskServerAction = (typeof KIOSK_SERVER_ACTIONS)[number];

/** Modes d'accès d'une borne. */
export type KioskMode = 'open' | 'targeted' | 'allowlist' | 'closed';

/** Un joueur désigné, par jeton et/ou par pseudo. */
export interface KioskPlayerRef {
  token: string | null;
  pseudo: string | null;
}

export type KioskCommand =
  | { action: 'mode'; mode: KioskMode; target: KioskPlayerRef | null; allowed: KioskPlayerRef[] | null }
  | { action: 'welcome'; title: string; subtitle: string }
  | { action: 'allow'; allowed: KioskPlayerRef[] }
  | { action: 'flash'; message: string; level: 'info' | 'warn' | 'error' }
  | { action: 'start'; player: KioskPlayerRef; question: string | null }
  | { action: 'stop' }
  | { action: 'abort'; reason: string | null }
  | { action: 'duration'; seconds: number }
  | { action: 'category'; category: string | null }
  | { action: 'questionMode'; mode: 'random' | 'sequence' }
  | { action: 'sequence'; ids: string[] }
  | { action: 'question:next'; text: string | null; playlistId: string | null }
  | { action: 'question:delete'; id: string }
  | { action: 'refresh' };

/** Durée d'une réponse, en secondes. Bornes communes à la borne et à la console. */
export function kioskDuration(value: unknown): number {
  const n = Number(value) || 0;
  return Math.min(600, Math.max(5, n));
}

/** Texte borné et débarrassé de ses espaces de garde. */
function text(value: unknown, max: number): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * Lit un joueur désigné sous ses deux formes : à plat comme l'envoie la console
 * (`{pseudo, token}` à la racine de la charge utile), ou groupé comme le rend
 * cette fonction (`{target}` / `{player}`).
 */
function playerRef(input: Record<string, unknown>, nested: 'target' | 'player'): KioskPlayerRef {
  const group = (input[nested] || {}) as Record<string, unknown>;
  return {
    pseudo: text(input.pseudo ?? group.pseudo, 24) || null,
    token: text(input.token ?? group.token, 64) || null,
  };
}

/**
 * Liste des joueurs autorisés à laisser un message sur une borne.
 *
 * On transporte le pseudo À CÔTÉ du jeton, et pas seulement le jeton : la borne
 * doit pouvoir afficher « Réservé à Marie, Paul et Léa » sur son écran, et elle
 * n'a pas toujours l'annuaire de la session sous la main (poste hors ligne,
 * session injoignable). Le pseudo est aussi le seul recours quand le badge
 * scanné ne porte pas de jeton.
 */
export function normalizeKioskAllowlist(input: unknown): KioskPlayerRef[] {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: KioskPlayerRef[] = [];
  for (const row of rows.slice(0, 100)) {
    const token = text((row as any) && (row as any).token, 64);
    const pseudo = text((row as any) && ((row as any).pseudo ?? row), 24);
    if (!token && !pseudo) continue;
    const key = token || pseudo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ token: token || null, pseudo: pseudo || null });
  }
  return out;
}

/**
 * Valide et met en forme une consigne avant de la pousser sur une borne.
 *
 * Appelée aux DEUX bouts : côté serveur pour qu'une faute de frappe dans la
 * console ne parte pas sur cinq bornes à la fois n'y produire que des refus
 * silencieux ; côté borne pour qu'une consigne malformée soit refusée avec un
 * message, plutôt qu'appliquée à moitié.
 *
 * **Idempotent** — et il doit le rester. La console envoie le joueur à plat
 * (`{pseudo, token}`), la sortie le range sous `target` / `player` ; la borne
 * repasse cette sortie dans la même fonction. Sans accepter les deux formes, ce
 * second passage effacerait le joueur désigné et la borne attendrait « quelqu'un »
 * sans savoir qui. Même raison pour `playlistId`, que le serveur résout APRÈS
 * normalisation : le perdre enverrait la vidéo sans rangement.
 *
 * @throws {Error} message destiné à être affiché tel quel à l'organisateur
 */
export function normalizeKioskCommand(body: unknown): KioskCommand {
  const action = String((body as any)?.action || '').trim();
  if (!ACTION_SET.has(action)) throw new Error(`Consigne inconnue : ${action || '(vide)'}`);
  const input = ((body as any)?.payload || {}) as Record<string, unknown>;

  switch (action as KioskAction) {
    case 'mode': {
      const wanted = String(input.mode || '');
      const mode = (['open', 'targeted', 'allowlist', 'closed'] as const)
        .find(m => m === wanted);
      if (!mode) throw new Error('Mode attendu : open, targeted, allowlist ou closed.');
      const target = mode === 'targeted' ? playerRef(input, 'target') : null;
      if (mode === 'targeted' && target && !target.pseudo && !target.token) {
        throw new Error('Le mode confessionnal exige un joueur.');
      }
      // Le mode « liste » embarque sa liste : la borne ne doit pas se retrouver
      // à filtrer sur une liste vide, ce qui reviendrait à fermer sans le dire.
      const allowed = mode === 'allowlist' ? normalizeKioskAllowlist(input.allowed) : null;
      if (mode === 'allowlist' && (!allowed || !allowed.length)) {
        throw new Error('Sélectionnez au moins un joueur autorisé.');
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
     * Filtre des joueurs autorisés, sans changer le mode. Une liste vide rouvre
     * la borne à tout le monde — c'est le geste inverse, et il doit rester
     * possible sans passer par le menu des modes.
     */
    case 'allow':
      return { action: 'allow', allowed: normalizeKioskAllowlist(input.allowed) };

    case 'flash': {
      const message = text(input.message, 160);
      if (!message) throw new Error('Message vide.');
      const level = (['info', 'warn', 'error'] as const).find(l => l === input.level) || 'info';
      return { action: 'flash', message, level };
    }

    case 'start': {
      const player = playerRef(input, 'player');
      if (!player.pseudo && !player.token) throw new Error('Indiquez un joueur.');
      return { action: 'start', player, question: text(input.question, 400) || null };
    }

    case 'stop':
      return { action: 'stop' };

    case 'abort':
      return { action: 'abort', reason: text(input.reason, 160) || null };

    case 'duration':
      return { action: 'duration', seconds: kioskDuration(input.seconds) };

    case 'category':
      return { action: 'category', category: text(input.category, 40) || null };

    case 'questionMode':
      return { action: 'questionMode', mode: input.mode === 'sequence' ? 'sequence' : 'random' };

    /**
     * Série de questions imposée. La borne sait l'appliquer depuis toujours et
     * sa régie web locale l'expose déjà (`POST /api/sequence`) ; la console
     * distante, elle, n'avait aucun moyen de l'atteindre. L'écart n'était
     * visible nulle part tant que le contrat vivait d'un seul côté.
     */
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
     * playlist déjà résolue au lieu de la remettre à `null`, sans quoi la
     * revalidation côté borne l'effacerait juste avant de l'appliquer.
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
  }

  // Inatteignable : `ACTION_SET` a déjà filtré. Présent pour que TypeScript
  // signale toute action ajoutée à la liste et oubliée dans le switch.
  throw new Error(`Consigne non traitée : ${action}`);
}
