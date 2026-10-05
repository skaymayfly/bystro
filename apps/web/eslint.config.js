import { noDirectDatabaseAccess } from "@bystro/config/eslint/base";
import next from "@bystro/config/eslint/next";

export default [...next, noDirectDatabaseAccess];
