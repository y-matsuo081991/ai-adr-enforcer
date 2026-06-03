import { z } from 'zod';
declare const JudgeResultSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
    }>;
    reasoning: z.ZodString;
}, z.core.$strip>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;
export declare class LlmJudge {
    private ai;
    constructor(apiKey: string);
    evaluate(adrContent: string, prDiff: string): Promise<JudgeResult>;
}
export {};
