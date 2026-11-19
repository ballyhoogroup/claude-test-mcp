interface DoctorOptions {
    /** The vendor's MCP URL (Streamable HTTP). */
    url: string;
    /** A customer's bearer token, when the server needs a login. */
    token?: string;
    /** A tool that is safe to call once, for the round trip. Without it the round trip is skipped. */
    tool?: string;
    args?: Record<string, unknown>;
    /** The vendor's Within API key, to ask Within what arrived. */
    apiKey?: string;
    /** Within's URL (SUPPORTBRIDGE_URL). */
    withinUrl?: string;
    /**
     * A check id from the console's "Check installation" button. The call is tagged with it and the
     * console shows what arrived, so no API key is needed here.
     */
    check?: string;
    fetch?: typeof fetch;
}
type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';
interface DoctorStep {
    name: 'connect' | 'tools' | 'card' | 'round trip';
    status: DoctorStatus;
    detail: string;
}
interface DoctorReport {
    /** False when any step failed. A warning or a skipped step still passes. */
    ok: boolean;
    steps: DoctorStep[];
}
declare function runDoctor(options: DoctorOptions): Promise<DoctorReport>;

export { type DoctorOptions, type DoctorReport, type DoctorStatus, type DoctorStep, runDoctor };
