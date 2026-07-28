/**
 * My day (SPEC FR-1205, FR-1212).
 *
 * The person-specific counterpart to the household view: not everything that
 * happens today, but what this person is on the hook for. The next three things
 * come first and the rest below, because the focus view exists for the moment
 * somebody is already overwhelmed — and a list that starts with everything is
 * the thing they are overwhelmed by.
 *
 * Both halves are the existing pieces: `FocusList` and `TodayScreen` already
 * render `selectNextThree` and `selectMyDay`. What this screen adds is the
 * order.
 */
import type { ReactNode } from "react";
import { Text } from "@cp/ui";
import { FocusList, TodayScreen } from "./TodayScreen.js";
import { useTranslator } from "../runtime.js";

export interface MyDayScreenProps {
  readonly personId: string;
}

export function MyDayScreen(props: MyDayScreenProps): ReactNode {
  const t = useTranslator();

  return (
    <>
      <Text role="heading1">{t.t("myday.title")}</Text>

      <Text role="heading3">{t.t("myday.nextThree")}</Text>
      <FocusList personId={props.personId} />

      <Text role="heading3">{t.t("calendar.today")}</Text>
      <TodayScreen personId={props.personId} />
    </>
  );
}
