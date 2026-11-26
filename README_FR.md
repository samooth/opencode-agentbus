> **Note :** Traduction française. Autres versions : [English](README.md) · [Español](README_ES.md) · [Français](README_FR.md) · [中文](README_ZH.md)

**Auteur :** Tomás Díaz <tomas@bsv.direct> · Licence : MIT

# opencode-agentbus

Protocole **portable** de communication entre sessions d'OpenCode V2. Issu du flux réel que nous utilisons dans Alloy : plusieurs agents travaillent en parallèle et s'écrivent via l'API sans que l'humain fasse le facteur. Pas de polling, pas de boucles de surveillance : le prompt injecté réveille la session.

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
| `bus_status` | Healthcheck : actif, alias, compteurs, messages en attente et configuration |
| `bus_audit` | Voir les livraisons capturées par le plugin |

Il enregistre également le skill `agent-bus` (`autoinvoke: false`, chargé avec `@agent-bus`), les commandes `/bus-help` et `/bus-report`, et **une seule** injection de règles dans le contexte de chaque session. Ne dupliquez pas le protocole dans les skills du projet : le plugin est la source du transport et le fichier de décisions du repo est la source des accords.

## Interface pour l'humain

La partie TUI (`./tui`) ajoute deux entrées dans la palette et comme slash commands :

- **`/bus-setup`** — assistant guidé : liste les sessions du projet, permet d'en choisir une, de lui donner un alias et d'assigner un rôle (`lead`, `dev` ou `reviewer`). Répétez l'étape autant de fois que nécessaire et enregistrez les alias et les rôles de façon persistante.
- **`/bus-audit`** — affiche les dernières livraisons avec date, session et `inboxID`, sans boucles ni sondage.

**`/bus-wizard`** affiche la liste numérotée des sessions du projet. L'humain choisit en écrivant dans le chat `número alias rol` (par exemple `1 lead lead`) ; le plugin enregistre l'alias avec `bus.setup`. L'assistant visuel TUI reste optionnel : s'il n'est pas détecté lors de l'installation, ce flux conversationnel remplit la même fonction.

Dans toute session, **`/bus-report`** écrit un rapport Markdown lisible avec alias, rôles, compteurs et livraisons récentes. Pour les outils externes, le plugin expose un RPC avec `overview`, `setAlias`, `audit` et `report` :

```bash
opencode api post '/api/rpc/agentbus/report?location[directory]=/ruta/del/proyecto' \
  --data '{"input":{"format":"md"}}'
```

Les rôles sont des informations pour l'humain et les clients ; le transport reste l'enveloppe du protocole et ne modifie ni la propriété des fichiers ni les gates.

## Bus nommés partagés

Un bus s'identifie par son nom (par exemple `alloy`) et peut avoir des membres issus de plusieurs projets. Chaque membre se connecte avec un alias et un rôle :

```text
/bus-connect alloy lead lead
```

Les outils `bus.connect`, `bus.use` et `bus.buses` sont également disponibles. Le **bus actif** est enregistré par projet ; les membres de chaque bus sont enregistrés globalement, si bien qu'un autre projet peut `bus.use("alloy")` et communiquer avec les mêmes alias. Les compteurs et l'audit restent séparés par projet. Les anciennes entrées sans préfixe restent historiques et ne sont pas migrées automatiquement.

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
