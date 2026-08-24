import { applicationStatuses } from "@manager/types";

export function GET() {
  return Response.json({
    service: "manager-web",
    status: "ok",
    contracts: { applicationStatuses: applicationStatuses.length },
  });
}
