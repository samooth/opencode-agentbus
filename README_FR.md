> **Note :** Traduction française. Autres versions : [English](README.md) · [Español](README_ES.md) · [Français](README_FR.md) · [中文](README_ZH.md)

**Auteur :** Tomás Díaz <tomas@bsv.direct> · Licence : MIT

# opencode-agentbus

Protocole **portable** de communication entre sessions d'OpenCode V2. Issu d'un flux de travail réel : plusieurs agents travaillent en parallèle et s'écrivent via l'API sans que l'humain fasse le facteur. Pas de polling, pas de boucles de surveillance : le prompt injecté réveille la session.

## Installer dans n'importe quel projet

Option A — paquet publié (recommandé) :

```bash
npm install opencode-agentbus
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-agentbus"]
}
```

Option B — plugin local (copiez ce repo ou clonez-le dans le projet) :

```text
tu-proyecto/.opencode/plugins/agentbus/   # ce repo, avec src/index.ts et PROTOCOL.md
```

Option C — depuis `opencode.jsonc` :

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/ruta/absoluta/opencode-agentbus"]
}
```

Options :

```jsonc
{
  "plugins": [{
    "package": "opencode-agentbus",
    "options": {
      "self": "lead",
      "aliases": {
        "lead": "ses_...",
        "beam": "ses_...",
        "particle": "ses_..."
      },
      "defaultDelivery": "queue",
      "requireEnvelope": false,
      "injectInstructions": true,
      "registerSkill": true,
      "registerCommands": true,
      "audit": true,
      "toolNamespace": "bus"
    }
  }]
}
```

Si vous ne transmettez pas `aliases`, enregistrez-les à chaud avec `bus_alias`. Pour obtenir les ID : `opencode api get /api/session`.

## Outils

| Outil | Usage |
|---|---|
| `bus_send` | Envoyer un message avec enveloppe ; `steer: true` uniquement pour les corrections/alertes |
| `bus_read` | Lire les messages déjà livrés dans une session (à la demande) |
| `bus_inbox` | Lister les messages envoyés et pas encore livrés (à la demande, sans polling) |
| `bus_directory` | Lister les alias et les sessions du projet |
| `bus_alias` | Enregistrer alias → session ID (persistant) |
| `bus_disconnect` | Déconnecter un alias du bus actif (ou du bus indiqué dans `bus`) |
| `bus_status` | Healthcheck : actif, alias, compteurs, messages en attente et configuration |
| `bus_audit` | Voir les livraisons capturées par le plugin |
| `bus_connect` | Connecter une session à un bus nommé avec alias et rôle |
| `bus_use` | Sélectionner le bus actif de ce projet |
| `bus_buses` | Lister les buses nommés et leurs membres |
| `bus_setup` | Enregistrer un alias depuis un `sessionID` (ou un index en cache), alias et rôle |

Il enregistre également le skill `agent-bus` (`autoinvoke: false`, chargé avec `@agent-bus`) et
**une seule** injection de règles dans le contexte de chaque session. Les seules commandes slash sont
`/bus-connect`, `/bus-setup` et `/bus-report`. Ne dupliquez pas le protocole dans les skills du
projet : le plugin est la source du transport et le fichier de décisions du repo est la source des
accords.

## Interface pour l'humain

La partie TUI (`./tui`) fournit deux commandes slash en dialogue : elles ouvrent des modales,
n'écrivent jamais dans la conversation et ne consomment pas d'inférence.

- **`/bus-setup`** — liste numérotée des sessions racines ; la personne choisit une session, un alias
  et un rôle (`lead`, `dev` ou `reviewer`). Le même dialogue permet de voir les alias actuels,
  afficher le rapport complet et déconnecter un alias. Les sous-agents sont exclus, les sessions déjà
  connectées sont marquées et l'ordre est stable.
- **`/bus-report`** — état complet : bus actif, alias/rôles, compteurs et livraisons récentes.
  `audit` en est le sous-ensemble « livraisons seulement ».

`/bus-connect <bus> <alias> <rôle>` connecte la session appelante à un bus nommé partagé.

Pour les outils externes, le plugin expose un RPC avec `overview`, `setAlias`, `disconnect`, `audit`
et `report` :

```bash
opencode api post '/api/rpc/agentbus/report?location[directory]=/ruta/del/proyecto' \
  --data '{"input":{"format":"md"}}'
```

Les rôles sont des informations pour l'humain et les clients ; le transport reste l'enveloppe du protocole et ne modifie ni la propriété des fichiers ni les gates.

## Bus nommés partagés

Un bus s'identifie par son nom (par exemple `team`) et peut avoir des membres issus de plusieurs projets. Chaque membre se connecte avec un alias et un rôle :

```text
/bus-connect team lead lead
```

Les outils `bus.connect`, `bus.use` et `bus.buses` sont également disponibles. Le **bus actif** est enregistré par projet ; les membres de chaque bus sont enregistrés globalement, si bien qu'un autre projet peut `bus.use("team")` et communiquer avec les mêmes alias. Les compteurs et l'audit restent séparés par projet. Les anciennes entrées sans préfixe restent historiques et ne sont pas migrées automatiquement.

## Message

```text
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<objet>

<corps>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## Règles d'or

1. Un message, un objet.
2. Confirmer avec `REPORT` + `replyTo`.
3. Mal routé → `CORRECCIÓN` avec `supersedes` et `steer`.
4. **Pas de polling** : ne sondez pas la boîte de réception et n'écrivez pas d'états périodiques. Restez inactif jusqu'à l'arrivée d'un prompt ; `bus_read` uniquement à la demande.
5. Fail-closed uniquement en cas de gates échoués ou d'urgences non traitées ; pas pour un silence normal.
6. L'API est un transport ; le fichier de décisions du repo est la source de vérité.
7. Ne changez pas de modèle à cause d'un rate limit sans l'autorisation de l'humain.

Le protocole complet se trouve dans `PROTOCOL.md`.

## Développement

```bash
npm install
npm run typecheck
npm test
```

Nécessite `@opencode/plugin` 2.4.1. L'API de la boîte de réception en attente n'est pas exposée dans le SDK du plugin : `bus_read` lit la transcription (messages livrés) ; pour vider la boîte de réception, utilisez l'API HTTP `DELETE /api/session/{id}/inbox/{inboxID}`.


## Dépannage

- **La partie TUI ne se charge pas (`Cannot find package 'solid-js'`)** — installez explicitement les
  dépendances peers : `npm install solid-js @opentui/core @opentui/solid`. npm les installe
  normalement automatiquement ; cela ne se produit qu'avec `legacy-peer-deps=true` ou npm < 7.
- **`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` lors d'un import `node` direct** — les points
  d'entrée sont en TypeScript par conception, conformément au contrat des plugins OpenCode. Chargez
  le plugin depuis OpenCode (Bun/tsx), pas directement avec `node`.
- **`RPC is unavailable: agentbus` juste après le démarrage du serveur** — les plugins se chargent
  de façon asynchrone. Patientez un instant et réessayez.
- **`rpc.unavailable: agentbus` dans la TUI** — le RPC est enregistré par emplacement. Configurez le plugin dans le `opencode.json(c)` du projet (pas seulement dans `cli.json`) et redémarrez. Une requête HTTP sans `location[directory]` renvoie aussi `rpc.unavailable` : c'est normal.
