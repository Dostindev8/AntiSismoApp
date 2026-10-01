import { useTranslations } from "next-intl";

import { buttonClass, StateMessage } from "@/components/StateMessage";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("states");
  return (
    <StateMessage
      icon="pin"
      title={t("notFoundTitle")}
      body={t("notFoundBody")}
      action={
        <Link href="/" className={buttonClass}>
          {t("backHome")}
        </Link>
      }
    />
  );
}
