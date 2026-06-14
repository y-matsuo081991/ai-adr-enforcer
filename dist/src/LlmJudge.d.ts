import { z } from 'zod';
declare const JudgeResultSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    reasoning: z.ZodString;
    risk_level: z.ZodOptional<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
    }>>;
    suggestion: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    remediation_status: z.ZodOptional<z.ZodEnum<{
        resolved: "resolved";
        unresolved: "unresolved";
        no_human_comments: "no_human_comments";
    }>>;
    remediation_advice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;
export declare class LlmJudge {
    private ai;
    constructor(apiKey: string);
    evaluate(adrContent: string, prDiff: string, humanComments?: string[]): Promise<JudgeResult>;
}
export {};
