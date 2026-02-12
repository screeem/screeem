/**
 * Environment variable validation and configuration
 */
import { z } from 'zod';
declare const envSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    PORT: z.ZodEffects<z.ZodDefault<z.ZodString>, number, string | undefined>;
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "production", "test"]>>;
    SUPABASE_URL: z.ZodString;
    SUPABASE_ANON_KEY: z.ZodString;
    SUPABASE_SERVICE_ROLE_KEY: z.ZodString;
    SUPABASE_JWT_SECRET: z.ZodString;
    FRONTEND_URL: z.ZodString;
    SMTP_HOST: z.ZodString;
    SMTP_PORT: z.ZodEffects<z.ZodString, number, string>;
    SMTP_USER: z.ZodString;
    SMTP_PASSWORD: z.ZodString;
    FROM_EMAIL: z.ZodString;
    TWITTER_CLIENT_ID: z.ZodOptional<z.ZodString>;
    TWITTER_CLIENT_SECRET: z.ZodOptional<z.ZodString>;
    TWITTER_CALLBACK_URL: z.ZodOptional<z.ZodString>;
    ENCRYPTION_KEY: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    DATABASE_URL: string;
    PORT: number;
    NODE_ENV: "development" | "production" | "test";
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_JWT_SECRET: string;
    FRONTEND_URL: string;
    SMTP_HOST: string;
    SMTP_PORT: number;
    SMTP_USER: string;
    SMTP_PASSWORD: string;
    FROM_EMAIL: string;
    TWITTER_CLIENT_ID?: string | undefined;
    TWITTER_CLIENT_SECRET?: string | undefined;
    TWITTER_CALLBACK_URL?: string | undefined;
    ENCRYPTION_KEY?: string | undefined;
}, {
    DATABASE_URL: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_JWT_SECRET: string;
    FRONTEND_URL: string;
    SMTP_HOST: string;
    SMTP_PORT: string;
    SMTP_USER: string;
    SMTP_PASSWORD: string;
    FROM_EMAIL: string;
    PORT?: string | undefined;
    NODE_ENV?: "development" | "production" | "test" | undefined;
    TWITTER_CLIENT_ID?: string | undefined;
    TWITTER_CLIENT_SECRET?: string | undefined;
    TWITTER_CALLBACK_URL?: string | undefined;
    ENCRYPTION_KEY?: string | undefined;
}>;
export type Env = z.infer<typeof envSchema>;
export declare const env: {
    DATABASE_URL: string;
    PORT: number;
    NODE_ENV: "development" | "production" | "test";
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_JWT_SECRET: string;
    FRONTEND_URL: string;
    SMTP_HOST: string;
    SMTP_PORT: number;
    SMTP_USER: string;
    SMTP_PASSWORD: string;
    FROM_EMAIL: string;
    TWITTER_CLIENT_ID?: string | undefined;
    TWITTER_CLIENT_SECRET?: string | undefined;
    TWITTER_CALLBACK_URL?: string | undefined;
    ENCRYPTION_KEY?: string | undefined;
};
export {};
//# sourceMappingURL=env.d.ts.map