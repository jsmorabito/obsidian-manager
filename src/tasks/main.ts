// Shim so task-tools source files can import the plugin by its original name.
import type ManagerPlugin from "../main";
export type TaskToolsPlugin = ManagerPlugin;
export default ManagerPlugin;
