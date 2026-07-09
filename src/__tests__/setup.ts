import moment from "moment";

(globalThis as Record<string, unknown>).moment = moment;
(window as unknown as Record<string, unknown>).moment = moment;

export {};
