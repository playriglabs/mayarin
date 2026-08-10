import { Badge } from "@/components/ui/badge";
import { PERMISSION_LABELS, type Permission } from "@/types/user";

const VISIBLE_PERMISSION_COUNT = 3;

function PermissionBadges({ permissions }: { readonly permissions: readonly Permission[] }) {
  const visible = permissions.slice(0, VISIBLE_PERMISSION_COUNT);
  const hidden = permissions.slice(VISIBLE_PERMISSION_COUNT);
  const hiddenLabels = hidden.map((permission) => PERMISSION_LABELS[permission]);

  return (
    <span className="flex flex-nowrap gap-1">
      {visible.map((permission) => (
        <Badge key={permission}>{PERMISSION_LABELS[permission]}</Badge>
      ))}
      {hidden.length > 0 && (
        <Badge
          title={hiddenLabels.join(", ")}
          aria-label={`${hidden.length} more permissions: ${hiddenLabels.join(", ")}`}
        >
          +{hidden.length}
        </Badge>
      )}
    </span>
  );
}

export { PermissionBadges };
