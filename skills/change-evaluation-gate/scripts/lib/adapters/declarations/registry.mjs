

/**
 * The v1 adapter set. Q-003 closed the question of additional clients: no
 * client beyond authoritative Git and these three local desktop surfaces
 * enters v1, and a later one needs its own compatibility evidence.
 */
const ADAPTER_REGISTRY = Object.freeze({
  git: Object.freeze({
    id: 'git',
    version: '1.0.0',
    surface: 'git-pre-commit',
    role: 'authoritative',
    // Authoritative Git does not register in a client configuration file at
    // all: its registration surface is this clone's own hook chain, which
    // activation composes through the declared hook strategy order. It says so
    // rather than leaving the field absent, because an adapter that declares no
    // registration surface has not told anyone where it registers
    // (FR-ADAPT-008).
    registration: Object.freeze({ kind: 'repository-hook-chain' }),
    nativeEvents: Object.freeze({ 'commit-attempt': 'pre-commit' }),
    // Nothing here is pending observation: Git's hook contract is specified,
    // and this surface is driven by the Gate's own hook program.
    unverifiedTriggers: Object.freeze([]),
    nativeIdentity: Object.freeze({
      event: 'hook',
      sessionId: 'commitProcessId',
      clientVersion: null,
      // Git sends no turn: a `pre-commit` invocation is an explicit operator
      // action that either happened or did not. There is no aborted commit
      // attempt to be told about (TB-027).
      turn: null,
      // Git invokes `pre-commit` at the repository root by its own contract, so
      // this surface receives a root rather than a path that might be inside
      // one. It declares that, instead of inheriting a desktop client's
      // resolution rule.
      repositoryRoot: Object.freeze({
        field: 'repositoryRoot',
        shape: 'path',
        resolution: 'declared-root',
      }),
    }),
    capabilities: Object.freeze({
      event: Object.freeze({ deterministic: true, normalizedTriggers: Object.freeze(['commit-attempt']) }),
      blocking: Object.freeze({ native: true }),
      // Nothing reviews this registration afterwards: Git has no per-hook
      // review or hash-trust workflow at all, so there is no later fact to
      // record and this adapter says so rather than leaving it absent.
      trust: Object.freeze({
        model: 'repository-hook-registration',
        failureIsUnverified: true,
        clientReview: null,
      }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'commit-process', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'git-hook',
        structuredResult: true,
        timeoutMs: 600_000,
      }),
      // No channel is needed, and none ever will be: this surface answers by
      // blocking, so a non-zero exit IS the answer (`TB-048`).
      feedback: Object.freeze({
        channel: null,
        field: null,
        none: '',
        maxIterations: null,
        absence: 'not-needed',
      }),
    }),
  }),
  'claude-code-desktop': Object.freeze({
    id: 'claude-code-desktop',
    version: '1.0.0',
    surface: 'claude-code-desktop-local-code-tab',
    role: 'preflight',
    // Observed from a real client configuration: this surface registers inside a
    // GENERAL settings file that also holds `permissions`, so registration is a
    // merge into a document the adapter mostly does not own (FR-ADAPT-008,
    // SG-HOOK-001).
    registration: Object.freeze({
      kind: 'client-configuration-file',
      file: '.claude/settings.local.json',
      ownership: 'shared-settings-file',
      container: Object.freeze(['hooks']),
      // Registration is keyed by the SAME declared native event the trigger
      // table already carries. One declared event name per adapter serves both
      // registration and trigger matching — but only per client, never shared.
      trigger: 'work-complete',
      blockSchema: 'matcher-group',
      matcher: '',
      commandType: 'command',
      // This file carries no version key of its own, so this client cannot
      // signal a breaking change to its registration format.
      schemaVersion: null,
    }),
    // Observed from a real client payload: `hook_event_name: "Stop"`.
    //
    // This client's hook events are fully enumerated and NONE of them is a
    // before-commit event, so the optional `commit-attempt` mapping is simply
    // absent — the same conservative non-declaration `codex-desktop` makes.
    // Deriving one from a tool-use event and a matcher would be a guessed
    // trigger, which FR-ADAPT-003 forbids.
    nativeEvents: Object.freeze({ 'work-complete': 'Stop' }),
    unverifiedTriggers: Object.freeze([]),
    nativeIdentity: Object.freeze({
      event: 'hook_event_name',
      sessionId: 'session_id',
      clientVersion: null,
      // No captured payload from this surface carries a turn status, so none is
      // declared and every event it sends is a completed turn — the behaviour
      // this surface has always had (TB-027).
      turn: null,
      // Observed `cwd` was NOT a repository root, while another client's `cwd`
      // was. Neither assumption is safe, so this surface declares that its
      // value is a path *within* a repository and must be resolved upward.
      repositoryRoot: Object.freeze({
        field: 'cwd',
        shape: 'path',
        resolution: 'resolve-upward',
      }),
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete']),
      }),
      blocking: Object.freeze({ native: false }),
      // This surface's registration is an entry the Gate merges into
      // `.claude/settings.local.json`, a file this activation writes at step 7.
      // Its trust is therefore the repository-bound consent granted at step 3
      // against a preview naming that exact surface, and nothing else: this
      // client documents settings and policy precedence rather than a
      // per-definition review flow, so there is no later client review to
      // record either (`TB-046`).
      trust: Object.freeze({
        model: 'repository-hook-registration',
        failureIsUnverified: true,
        clientReview: null,
      }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'client-session', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'child-process',
        structuredResult: true,
        timeoutMs: 300_000,
      }),
      // No channel is declared because none has been observed: this surface
      // has not been driven by a real client invocation, so how it takes an
      // answer back is unknown and is not guessed. Until it is observed this
      // surface stays declared and testable, and is never registered: a
      // preflight that cannot answer would evaluate every turn into silence
      // (`TB-048`, `SG-SUPPORT-001`).
      feedback: Object.freeze({
        channel: null,
        field: null,
        none: '',
        maxIterations: null,
        absence: 'not-observed',
      }),
    }),
  }),
  'codex-desktop': Object.freeze({
    id: 'codex-desktop',
    version: '1.0.0',
    surface: 'codex-desktop-local-project',
    role: 'preflight',
    // Observed from a real client configuration: a DEDICATED hooks file whose
    // block shape happens to match the other capitalised-event surface today.
    // That convergence is an observation, not a guarantee, so this declaration
    // is its own and is not shared: one client's change may never silently
    // redefine another's (FR-ADAPT-004, FR-ADAPT-008).
    registration: Object.freeze({
      kind: 'client-configuration-file',
      file: '.codex/hooks.json',
      ownership: 'dedicated-hooks-file',
      container: Object.freeze(['hooks']),
      trigger: 'work-complete',
      blockSchema: 'matcher-group',
      matcher: '',
      commandType: 'command',
      schemaVersion: null,
    }),
    // This surface exposes no deterministic pre-commit event. The optional
    // `before-commit-attempt` mapping is therefore simply absent; the adapter
    // does not invent one (FR-ADAPT-003).
    // Observed from a real client payload: `hook_event_name: "Stop"`.
    nativeEvents: Object.freeze({ 'work-complete': 'Stop' }),
    unverifiedTriggers: Object.freeze([]),
    nativeIdentity: Object.freeze({
      event: 'hook_event_name',
      sessionId: 'session_id',
      clientVersion: null,
      // As with the other desktop surface, no captured payload carries a turn
      // status, so none is declared (TB-027).
      turn: null,
      // Observed as a repository root here and NOT one under another client.
      // Same field name, same shape, different truth — so this surface
      // declares its own resolution rule rather than sharing one.
      repositoryRoot: Object.freeze({
        field: 'cwd',
        shape: 'path',
        resolution: 'resolve-upward',
      }),
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete']),
      }),
      blocking: Object.freeze({ native: false }),
      // Same registration surface reasoning as the other desktop clients: the
      // Gate writes `.codex/hooks.json` at step 7, so the grant that trust can
      // establish at step 5 is the repository-bound consent to that exact
      // registration.
      //
      // This client is the one v1 surface with a REAL review of its own, and it
      // is a post-registration one: a non-managed command hook is skipped until
      // its exact definition is reviewed and trusted in Codex, which happens the
      // next time Codex reads this file — after this activation wrote it. It is
      // recorded here as a fact about what happens next and never waited for,
      // because waiting for it could never succeed (`FR-LIFE-004`,
      // `SG-TRUST-001`).
      trust: Object.freeze({
        model: 'repository-hook-registration',
        failureIsUnverified: true,
        clientReview: Object.freeze({
          when: 'after-registration',
          mechanism: 'definition-review',
          detail: 'Codex skips a non-managed command hook until its exact definition is reviewed and trusted in Codex; that review happens the next time Codex reads .codex/hooks.json, so this registration is written but is not yet running — review and trust it in Codex.',
        }),
      }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'client-session', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'child-process',
        structuredResult: true,
        timeoutMs: 300_000,
      }),
      // No channel is declared because none has been observed: this surface
      // has not been driven by a real client invocation, so how it takes an
      // answer back is unknown and is not guessed. Until it is observed this
      // surface stays declared and testable, and is never registered: a
      // preflight that cannot answer would evaluate every turn into silence
      // (`TB-048`, `SG-SUPPORT-001`).
      feedback: Object.freeze({
        channel: null,
        field: null,
        none: '',
        maxIterations: null,
        absence: 'not-observed',
      }),
    }),
  }),
  cursor: Object.freeze({
    id: 'cursor',
    version: '1.0.0',
    surface: 'cursor-ide-local-agent',
    role: 'preflight',
    // A DEDICATED hooks file that is INDEPENDENTLY VERSIONED and whose block
    // shape is FLAT: no matcher, no type, just a command. It is the only v1
    // surface that can signal a breaking change to its own registration format,
    // which is exactly why the schema-versioning behaviour is declared rather
    // than assumed (FR-ADAPT-008, RISK-004).
    //
    // Reported by the Product Owner rather than read from a live configuration,
    // unlike this surface's payload evidence. It is declared here so a real
    // client-driven run can confirm or refute it.
    registration: Object.freeze({
      kind: 'client-configuration-file',
      file: '.cursor/hooks.json',
      ownership: 'dedicated-hooks-file',
      container: Object.freeze(['hooks']),
      trigger: 'work-complete',
      blockSchema: 'flat-command',
      matcher: null,
      commandType: null,
      schemaVersion: Object.freeze({ key: 'version', value: 1 }),
    }),
    // Observed from a real client payload: `hook_event_name: "stop"`, in
    // lowercase, where the other two surfaces send `"Stop"`.
    nativeEvents: Object.freeze({ 'work-complete': 'stop' }),
    // Not observed and not disproven. No capture has yet shown whether this
    // surface emits a deterministic pre-commit event, so it is neither claimed
    // nor forgotten: it is absent from `nativeEvents` and from
    // `capabilities.event.normalizedTriggers`, so nothing can normalize to it,
    // and recorded here so release qualification knows what is still open.
    // This is a different absence from the other two surfaces', whose client
    // event sets are enumerated and contain no such event (FR-ADAPT-003,
    // Q-004).
    unverifiedTriggers: Object.freeze(['commit-attempt']),
    nativeIdentity: Object.freeze({
      event: 'hook_event_name',
      sessionId: 'session_id',
      // This client self-reports its exact version in every payload.
      clientVersion: 'cursor_version',
      // Observed from a real client payload: this surface's `stop` event fires
      // whether the turn finished or the operator stopped it, and says which in
      // `status`. Only a completed turn is `work-complete`; an interrupted one
      // is the operator's decision and is answered with nothing at all. A value
      // in neither list is not guessed into either (TB-027, FR-ADAPT-003).
      //
      // The client also reports how many auto-follow-ups it has submitted. Every
      // captured payload reported `0`, including during an observed loop, so it
      // is read as a bound when it advances and never relied on when it does
      // not.
      turn: Object.freeze({
        status: 'status',
        completed: Object.freeze(['completed']),
        interrupted: Object.freeze(['aborted', 'error']),
        iteration: 'loop_count',
      }),
      // This surface sends an ARRAY of workspace roots and supports multi-root
      // workspaces, so its declaration differs in shape from both other
      // desktop surfaces.
      repositoryRoot: Object.freeze({
        field: 'workspace_roots',
        shape: 'path-array',
        resolution: 'resolve-upward',
      }),
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete']),
      }),
      blocking: Object.freeze({ native: false }),
      // The surface whose declaration produced the defect. `.cursor/hooks.json`
      // is written by this activation at step 7; this client documents project
      // and user hook configuration and a plugin marketplace review, and the
      // framework installs Agent Skills rather than a Cursor plugin, so no
      // marketplace review applies and nothing describes a per-workspace grant
      // a process could read before registration (`TB-046`).
      trust: Object.freeze({
        model: 'repository-hook-registration',
        failureIsUnverified: true,
        clientReview: null,
      }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'client-session', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'child-process',
        structuredResult: true,
        timeoutMs: 300_000,
      }),
      feedback: Object.freeze({
        channel: 'stdout-json',
        field: 'followup_message',
        none: '',
        // This channel re-prompts the agent, so an answer on it is an action,
        // not a notification. Two says what failed and gives one turn to act
        // on it; a third repetition of an unchanged verdict has nothing to add
        // and is how a preflight becomes a loop (TB-027).
        maxIterations: 2,
        absence: null,
      }),
    }),
  }),
});

export const ADAPTER_IDS = Object.freeze(Object.keys(ADAPTER_REGISTRY));

export const DESKTOP_ADAPTER_IDS = Object.freeze(
  ADAPTER_IDS.filter((id) => ADAPTER_REGISTRY[id].role === 'preflight'),
);

/** Resolve one adapter's static identity, or `null` when it is not a v1 adapter. */
export const describeAdapter = (adapterId) => ADAPTER_REGISTRY[adapterId] ?? null;
