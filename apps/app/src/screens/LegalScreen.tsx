/**
 * The privacy policy, the provider identification and where data goes
 * (FR-1401, FR-1402, FR-1404).
 *
 * Reachable without an account and without a network connection, because that
 * is what "in the app" means: a person deciding whether to trust this thing
 * has to be able to read it before they join anything, and a link to a website
 * would fail exactly when they are offline in a doctor's waiting room.
 *
 * The placeholders are shown rather than hidden. A policy that names no
 * controller is not a policy, and the person reading it deserves to see that as
 * plainly as the operator who has to fix it.
 */
import { useState, type ReactNode } from "react";
import { Alert, Card, List, Tabs, Text } from "@cp/ui";
import {
  DATA_FLOWS,
  imprint,
  pendingPlaceholders,
  privacyPolicy,
  type LegalDocument,
} from "@fam/domain";
import { useTranslator } from "../runtime.js";

type Tab = "privacy" | "provider" | "flows";

export function LegalScreen(): ReactNode {
  const t = useTranslator();
  const [tab, setTab] = useState<Tab>("privacy");

  // The document follows the app's language rather than a setting of its own:
  // a person reading their rights should not have to find a second switch.
  const locale = t.locale === "de" ? "de" : "en";

  return (
    <>
      <Text role="heading1">{t.t("legal.title")}</Text>

      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} testID="legal-tabs">
        <Tabs.List>
          <Tabs.Tab value="privacy" label={t.t("legal.privacy")} testID="legal-tab-privacy" />
          <Tabs.Tab value="provider" label={t.t("legal.provider")} testID="legal-tab-provider" />
          <Tabs.Tab value="flows" label={t.t("legal.flows")} testID="legal-tab-flows" />
        </Tabs.List>
      </Tabs>

      {tab === "privacy" ? <Document document={privacyPolicy(locale)} testID="legal-privacy" /> : null}
      {tab === "provider" ? <Document document={imprint(locale)} testID="legal-provider" /> : null}
      {tab === "flows" ? <Flows /> : null}
    </>
  );
}

function Document(props: { readonly document: LegalDocument; readonly testID: string }): ReactNode {
  const t = useTranslator();
  const pending = pendingPlaceholders(props.document);

  return (
    <>
      <Text role="caption">
        {t.t("legal.version", { version: props.document.version, date: props.document.effectiveDate })}
      </Text>

      {/* Not a warning for developers: a reader is entitled to know the document
          in front of them is unfinished, and which parts of it are. */}
      {pending.length === 0 ? null : (
        <Alert
          variant="warning"
          label={t.t("legal.incomplete")}
          hint={pending.join(", ")}
          testID={props.testID + "-incomplete"}
        />
      )}

      {props.document.sections.map((section) => (
        <Card key={section.heading} variant="outlined">
          <Card.Body>
            <Text role="heading3">{section.heading}</Text>
            {section.body.map((paragraph) => (
              <Text key={paragraph} role="body">
                {paragraph}
              </Text>
            ))}
          </Card.Body>
        </Card>
      ))}
    </>
  );
}

/**
 * FR-1404. Which recipient, for what, and whether the family can say no —
 * the last column being the one that decides whether the consent asked for
 * elsewhere is freely given at all.
 */
function Flows(): ReactNode {
  const t = useTranslator();

  return (
    <List testID="legal-flows-list">
      <List.Header label={t.t("legal.flows")} />
      {DATA_FLOWS.map((flow) => (
        <List.Item
          key={flow.recipient}
          label={flow.recipient}
          subtitle={`${flow.purpose} · ${flow.data} · ${flow.location}`}
          leadingIcon={flow.optional ? "help-circle" : "alert-triangle"}
          testID={"legal-flow-" + flow.recipient.replace(/\W+/g, "-").toLowerCase()}
        />
      ))}
    </List>
  );
}
