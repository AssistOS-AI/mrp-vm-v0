# MRP-VM v0 Implementation Maturity Review (@gemini_review.md)

Acest document evaluează stadiul implementării față de specificațiile DS000-DS021. Deși majoritatea specificațiilor sunt marcate ca `planned`, realitatea din `src/` arată o implementare avansată (aprox. 85% acoperire).

---

## 1. Analiză Maturitate (Realitate vs. Specificații)

| Subproces | Stadiu Specificație | Stadiu Real | Observații |
| --- | --- | --- | --- |
| **Core VM & Epochs** | Planned | Implemented | `MRPVM` (src/runtime/vm.mjs) implementează ciclul de epoci și managementul stării. |
| **SOP Lang Parser** | Planned | Implemented | Parserul (src/lang/parser.mjs) este complet și conform cu DS018. |
| **Family State Store** | Planned | Implemented | `StateStore` gestionează variantele, metadatele și selecția reprezentantului. |
| **Native Commands** | Planned | Partial | Toate cele 7 comenzi native sunt prezente, cu mici lipsuri în `analytic-memory`. |
| **Knowledge Store** | Planned | Implemented | `KbStore` suportă snapshoting și retrieval simbolic. |
| **Trace & Replay** | Planned | Implemented | TraceStore produce JSONL conform cu DS014. |
| **Security Sandbox** | Planned | Partial | `js-eval` folosește `node:vm` în loc de procese izolate (DS004). |

---

## 2. Neconformități Identificate (Ce trebuie schimbat)

### 2.1. Structura Repozitoriului (DS001)
*   **Problemă:** Specificația cere folderul `server/` la rădăcină.
*   **Realitate:** Acesta este plasat în `src/server/`.
*   **Acțiune:** Mutarea `src/server/` în `server/`.

### 2.2. Interfața Helper `js-eval` (DS007)
*   **Problemă:** Specificația definește metoda `sop.declare(text, meta?)`.
*   **Realitate:** Implementarea folosește `sop.insertDeclarations`.
*   **Acțiune:** Redenumirea metodei în `src/commands/js-eval.mjs`.

### 2.3. Funcționalități Lipsă în `analytic-memory` (DS010)
*   **Problemă:** Lipsesc operațiile `group`, `rank` și `threshold flagging`.
*   **Realitate:** Doar operațiile de bază (store, append, merge, derive, rollup, export) sunt implementate.
*   **Acțiune:** Adăugarea suportului pentru agregările complexe rămase.

### 2.4. Securitate Sandbox (DS004)
*   **Problemă:** DS004 cere izolare prin procese pentru `js-eval`.
*   **Realitate:** Se folosește `node:vm`, care este vulnerabil la evadări din sandbox în medii Node.js standard.
*   **Acțiune:** Implementarea unui wrapper de execuție în proces separat (Worker sau Subprocess).

### 2.5. Sincronizarea Statusului (matrix.md)
*   **Problemă:** Majoritatea DS-urilor sunt marcate `status: planned`.
*   **Realitate:** Codul este în mare parte funcțional.
*   **Acțiune:** Actualizarea statusului în `matrix.md` și în frontmatter-ul fișierelor DS la `implemented` sau `in-progress`.

---

## 3. Întrebări de Arhitectură (Noi observații din cod)

1.  **Atomicitatea Buffer-ului (DS003):** Codul actual (vm.mjs) aplică efectele (`applyEffects`) imediat după execuția fiecărui nod, dar nu pare să aibă un mecanism de rollback dacă o epocă eșuează parțial.
2.  **Validarea `plannerLLM`:** În `planning.mjs`, output-ul de la LLM este inserat aproape direct în plan. Lipsește o etapă de validare sintactică riguroasă înainte de persistență.
3.  **Deduplicarea în Context (DS005):** Implementarea din `context-package.mjs` trebuie verificată pentru a asigura "exact deduplication" conform specificației.
