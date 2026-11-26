> **Note :** Traduction française. Autres versions : [English](PROTOCOL.md) · [Español](PROTOCOL_ES.md) · [Français](PROTOCOL_FR.md) · [中文](PROTOCOL_ZH.md)

# Agent Bus — protocole de communication entre sessions

Ce skill est injecté par le plugin `opencode-agentbus`. Objectif : que plusieurs agents travaillent en parallèle **sans que l'humain fasse le facteur** et sans l'interrompre sauf fail-closed.

## 1. Transport

Le bus utilise l'API d'OpenCode (`session.prompt`) pour livrer des prompts à d'autres sessions. Le plugin enregistre les outils `bus_*` ; l'API est un transport, **pas une source de vérité**. Les accords sont consignés dans le fichier de décisions du projet (par exemple `FEEDBACK.md` ou `DECISIONS.md`).

## 2. Enveloppe obligatoire

Tout message commence par une ligne indiquant le nom de l'expéditeur :

```
[FROM @lead → TO @beam | 2026-11-24T10:00:00Z | ID MSG-... | TYPE DECISION | REPLY-TO MSG-... | SUPERSEDES MSG-...]
<objet>

<corps>

— @lead
```

`TYPE` ∈ `QUESTION | REPORT | DECISION | CORRECCIÓN | ALERT | INFO`.

## 3. Livraison

- `queue` (par défaut) : le message attend dans la boîte de réception et est livré un par un lorsque l'agent termine son travail en cours.
- `steer` : interrompt le travail en cours. Uniquement pour `CORRECCIÓN` et `ALERT`.

L'outil `bus_send` accepte `steer: true` pour choisir la priorité.

## 4. Règles

1. **Un message, un objet.** Ne mélangez pas les sujets de deux destinataires : c'est la cause la plus fréquente de routage erroné.
2. **Confirmer la réception** avec `REPORT` et `replyTo` pointant vers l'ID reçu.
3. **Message mal routé** : ne l'exécutez pas ; signalez-le et renvoyez-le avec `supersedes` pointant vers l'ID invalide et la priorité `steer`.
4. **NO POLLING, PAS DE BOUCLES DE SURVEILLANCE.** Le prompt est injecté directement dans la session et la réveille : il n'est pas nécessaire de sonder la boîte de réception ni de s'envoyer des messages à soi-même. Restez **inactif** lorsque vous n'avez pas de travail ; n'écrivez pas d'entrées périodiques de « surveillance finale » et ne répétez pas votre état. `bus_read` est uniquement à la demande. Cela économise des tokens et de l'inférence.
5. **Fail-closed avec discernement :** si un gate échoue ou qu'un message URGENT n'est pas traité, escaladez vers l'humain. N'escaladez pas parce qu'il n'y a « pas de nouveaux messages » : c'est un fonctionnement normal.
6. **N'attendez pas l'humain** : interrogez le bus et poursuivez une autre tâche indépendante.
7. **Le transport ne modifie ni la propriété des fichiers ni les gates.** N'utilisez jamais `--no-verify` et ne modifiez pas des contrats figés à cause d'un message.
8. **Ne changez pas le modèle d'une session** à cause d'un rate limit ou d'un retry sans autorisation explicite de l'humain ; signalez l'incident et attendez.

## 5. File de travail

Chaque agent maintient sa propre file (par exemple `docs/LEAD_QUEUE.md`) avec des éléments `DONE / NEXT / BLOCKED / ABIERTO`. Le bus ne fait que transporter ; la file est le registre durable.

## 6. Historique et audit

Le plugin enregistre les événements `session.inbox.delivered` dans son stockage (`bus_audit`). La boîte de réception est vidée avec l'API `/api/session/{id}/inbox` lorsque les messages sont déjà consignés dans le repo.
