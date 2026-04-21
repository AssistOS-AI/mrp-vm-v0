---
id: DS024
title: Chat UX and Traceability Interface
status: proposed
owner: ui
summary: Defines the detailed UX specification for the chat surface, request traceability workspace, nested KB tree browser, and authentication-aware settings page.
---

# DS024 Chat UX and Traceability Interface

## Introduction

This specification defines the detailed user experience for the MRP-VM v0 interface. DS022 owns the route structure and API contracts. DS024 owns detailed page composition, visual hierarchy, interaction affordances, and the required UI behaviors for chat, traceability, KB browsing, and settings.

## Core Content

### Design principles

1. **Conversation-first**: Chat must feel lightweight and uncluttered.
2. **Operational depth by navigation**: Trace, KB inspection, and settings live on dedicated pages.
3. **Selection before density**: Default views stay compact; detail appears only when the user selects a request, variable, node, or KU.
4. **Trace clarity**: The execution path must be understandable visually, not only through raw JSON.
5. **Auth transparency**: The current API-key role and saved-key context must be obvious whenever protected operations are available.

### Chat page

The chat page uses a full-height layout with:

1. a compact sticky header containing branding, navigation, session selector, and auth badges,
2. one scrollable conversation surface,
3. one bottom composer.

The header must not waste the first screen with large session panels. Session creation and switching happen through a compact selector in the header.

The composer must expose:

1. the main text input,
2. a send button,
3. a subtle icon-triggered `Advanced options` popover positioned immediately before the input area rather than as a separate toolbar row,
4. a two-level flow where the first level lists categories and the second level shows the selected detail panel,
5. text-file import that appends file contents into the input,
6. budget controls,
7. a small list of predefined demo tasks that highlight different runtime commands and interpreters.

While the runtime is working, the transcript shows an assistant placeholder bubble with animated `Thinking...` text until the final response arrives.

### Traceability page

The traceability page uses two primary columns:

1. a left request timeline,
2. a right detail workspace.

The page must not show redundant placeholder headers such as "Select a request" or request/response summary tiles above the main workspace once a request is selected.

The detail workspace exposes exactly three tabs:

1. `SOP Lang`
2. `Variables`
3. `Execution Graph`

#### SOP Lang tab

This tab shows the executed SOP Lang program for the selected request in a scrollable code surface with a copy action.

#### Variables tab

This tab must use a split layout:

1. a left variable list, one row per family,
2. a right detail area for the selected variable.

The right detail area contains exactly three nested tabs:

1. `Current Value` for the representative value at the end of execution,
2. `Metadata` for family and representative metadata,
3. `Definition` for the SOP declaration that defines the variable in the executed plan.

#### Execution Graph tab

This tab renders the execution graph as a left-to-right workflow ordered by topological layer. The graph must show:

1. small readable nodes,
2. the variable name on one line,
3. the executed command or interpreter name on a second line with a distinct style,
4. ellipsis when labels are too long,
5. explicit dependency arrows between layers.

The graph is not a textual edge list. It is a spatial workflow view that makes dependency structure obvious at a glance.

### KB Browser page

The KB Browser uses:

1. a summary row,
2. a filter row,
3. a two-column main area with tree on the left and inspector/editor on the right.

The left side is a nested tree rooted at `All KUs`. It is closed by default. The minimum branch order is:

1. `Default KUs`
2. `Global KUs`
3. `Session KUs`

Within those scope branches, the UI may add deeper levels such as KU type groups before the final KU leaf items.

The right side contains:

1. inspector details for the selected KU,
2. the editable SOP source,
3. action buttons including `Save` and `Default` placed below the editor body.

The editor must remain to the right of the tree on wide screens rather than collapsing below it unnecessarily.

### Settings page

The settings page uses exactly three tabs:

1. `Models`
2. `Interpreters`
3. `Authentication`

There is no separate runtime-overview tab.

#### Models tab

The models tab uses compact select controls laid out in two columns when width allows. The tab must:

1. expose default-model and profile-binding selects,
2. show model tags inline inside select option labels,
3. optionally filter the visible list by tag,
4. avoid a separate candidate-model gallery once the select controls already reveal the catalog.

#### Interpreters tab

The interpreters tab shows one compact row per interpreter. Status, purpose, cost class, adapter type, and enabled toggle should fit naturally in one row on desktop rather than being stretched vertically without need.

#### Authentication tab

The authentication tab must support:

1. first-login bootstrap-admin API-key creation when no keys exist,
2. local storage of saved API keys,
3. autocomplete or pick-list selection among locally saved keys,
4. switching the active API key,
5. creating additional keys with explicit role,
6. revoking keys when authorized.

When the page loads and saved keys exist, the UI should prompt for or suggest an API key rather than hiding the current auth state.
Switching keys should clear stale session assumptions so subsequent protected pages and newly created sessions use the newly selected authority context coherently.

### CSS and JavaScript ownership

All styles live in `server/public/app.css`. All interaction logic lives in page-specific modules under `server/public/`. HTML structure remains in `server/templates/`. JavaScript may fill data into those structures, but layout authority stays in templates and CSS.

## Decisions & Questions

Question #1: Why keep chat compact and push operational detail to separate pages?

Response: The runtime is operationally rich, but users still need a readable conversation surface. If chat inlines trace, graph, and KB state by default, the main interaction becomes noisy and harder to scan.

Question #2: Why must the Variables tab use a split list-and-detail layout?

Response: Variable inspection is selection-heavy. Users need to browse many variables quickly, then inspect one deeply. A split layout supports both behaviors without making the page excessively tall.

Question #3: Why insist on a graphical left-to-right execution graph instead of only node cards?

Response: Execution order and dependency shape are architectural facts, not incidental metadata. A workflow view makes the topological structure visible immediately in a way that flat cards or edge lists do not.

## Conclusion

MRP-VM v0 should present a clean conversation surface, a precise traceability workspace, a genuinely navigable KB browser, and an authentication-aware settings surface that supports real operator workflows rather than placeholder controls.
