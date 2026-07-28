/**
 * The app's runtime: one sync client, one translator, one acting person.
 *
 * Screens never construct any of these. They ask for what they need and get a
 * value that re-renders when the family's state changes, which keeps the
 * "somebody else just ticked that off" case working without a single screen
 * having to think about it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { FamilyState } from "@fam/domain";
import type { SyncClient } from "@fam/sync";
import { DEFAULT_LOCALE, createTranslator, type Locale, type Translator } from "@fam/i18n";

export interface AppRuntime {
  readonly client: SyncClient;
  readonly translator: Translator;
  /** Null on a shared device acting as the household (SPEC FR-116). */
  readonly actorId: string | null;
  readonly setActorId: (personId: string | null) => void;
  readonly online: boolean;
  readonly now: () => number;
}

const RuntimeContext = createContext<AppRuntime | undefined>(undefined);

export interface AppProviderProps {
  readonly client: SyncClient;
  readonly actorId: string | null;
  readonly setActorId: (personId: string | null) => void;
  readonly online?: boolean;
  readonly locale?: Locale;
  readonly now?: () => number;
  readonly children: ReactNode;
}

export function AppProvider(props: AppProviderProps): ReactNode {
  const { client, actorId, setActorId } = props;

  // Attribution follows the selected person, so a kiosk that has just asked who
  // is standing there records the answer on the next operation (FR-917).
  useEffect(() => {
    client.setActor(actorId);
  }, [client, actorId]);

  const runtime = useMemo<AppRuntime>(
    () => ({
      client,
      translator: createTranslator(props.locale ?? DEFAULT_LOCALE),
      actorId,
      setActorId,
      online: props.online ?? true,
      now: props.now ?? (() => Date.now()),
    }),
    [client, props.locale, actorId, setActorId, props.online, props.now],
  );

  return <RuntimeContext.Provider value={runtime}>{props.children}</RuntimeContext.Provider>;
}

export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === undefined) {
    throw new Error("useRuntime must be used inside AppProvider");
  }
  return runtime;
}

export function useTranslator(): Translator {
  return useRuntime().translator;
}

/**
 * Subscribe to the family's state.
 *
 * The client emits on every local change and every pull, so a screen re-renders
 * when the other parent's phone reaches the server — which is the entire point of
 * the shopping list being usable by two people at once (FR-711).
 */
export function useFamilyState(): FamilyState {
  const { client } = useRuntime();

  const subscribe = useCallback((onChange: () => void) => client.onChange(onChange), [client]);
  const getSnapshot = useCallback(() => client.state(), [client]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Run a command, which is the only way a screen changes anything. */
export function useMutate(): SyncClient["mutate"] {
  const { client } = useRuntime();
  return useCallback((describe) => client.mutate(describe), [client]);
}
