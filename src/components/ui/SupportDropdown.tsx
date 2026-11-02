import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { HelpCircle, Bug, BookOpen } from "../icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
export default function SupportDropdown({
  className,
  trigger,
}: {
  className?: string;
  trigger?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className={className}>
            <HelpCircle size={16} />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() =>
            window.electronAPI?.openExternal("https://github.com/valoche-68/whisprlocal#readme")
          }
        >
          <BookOpen className="me-2 h-4 w-4" />
          {t("support.documentation")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            window.electronAPI?.openExternal("https://github.com/valoche-68/whisprlocal/issues")
          }
        >
          <Bug className="me-2 h-4 w-4" />
          {t("support.submitBug")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
