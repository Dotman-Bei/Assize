/**
 * Zod schemas for the four structures named in PRD §8.1: commitment, sample,
 * verdict, claim. Validation is the boundary between "some JSON arrived" and
 * "this is a sample", and PRD §0.9 makes an unlabelled sample a bug rather than
 * a datum, so the strict schemas below reject one.
 */

import { z } from "zod";
import {
  MAX_UINT32,
  MAX_UINT64,
  MAX_UINT128,
  SAMPLE_SOURCES,
  VERDICT_STATES,
} from "./index.js";

const uintOfWidth = (max: bigint, label: string) =>
  z
    .bigint()
    .nonnegative({ message: `${label} must not be negative` })
    .max(max, { message: `${label} exceeds its storage width` });

export const uint128 = (label: string) => uintOfWidth(MAX_UINT128, label);
export const uint64 = (label: string) => uintOfWidth(MAX_UINT64, label);
export const uint32 = (label: string) => uintOfWidth(MAX_UINT32, label);

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u, { message: "not a 32-byte hex string" })
  .transform((value) => value.toLowerCase() as `0x${string}`);

export const verdictStateSchema = z.enum(VERDICT_STATES);

export const storedSampleSourceSchema = z.enum(SAMPLE_SOURCES);

/** A source a correctly written sample may carry (PRD §0.9). */
export const sampleSourceSchema = z.enum(["REACTIVITY", "KEEPER"]);

/**
 * A sample as it may sit in storage, including shapes that are defective. The
 * evaluator must be total over these (PRD §13 property tests), so this schema
 * checks widths and nothing else.
 */
export const storedSampleSchema = z.object({
  bid: uint128("bid"),
  ask: uint128("ask"),
  bidSize: uint128("bidSize"),
  askSize: uint128("askSize"),
  blockNumber: uint64("blockNumber"),
  blockHash: bytes32Schema,
  source: storedSampleSourceSchema,
});

/**
 * A sample Assize is willing to write. Stricter than {@link storedSampleSchema}:
 * it must be labelled and it must be pinned to a block (PRD §6, §12).
 */
export const writableSampleSchema = storedSampleSchema.extend({
  source: sampleSourceSchema,
  blockNumber: uint64("blockNumber").refine((n) => n > 0n, {
    message: "a sample must pin a block number",
  }),
  blockHash: bytes32Schema.refine((h) => !/^0x0{64}$/u.test(h), {
    message: "a sample must pin a block hash",
  }),
});

export const commitmentEnvelopeSchema = z
  .object({
    maxSpread: uint32("maxSpread"),
    minSize: uint128("minSize"),
    start: uint64("start"),
    end: uint64("end"),
  })
  .refine((c) => c.start <= c.end, {
    message: "commitment window ends before it starts",
  });

/**
 * PRD §21. A claim carries the rung its evidence actually reaches. `rung` may
 * never exceed what `evidence` supports; `pnpm claim:verify` enforces that.
 */
export const proofRungSchema = z.enum(["R0", "R1", "R2", "R3", "R4"]);

export const claimEvidenceSchema = z.object({
  rung: proofRungSchema,
  description: z.string().min(1),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/u).optional(),
  command: z.string().min(1).optional(),
  recordedAt: z.string().min(1),
});

export const claimSchema = z.object({
  id: z.string().regex(/^C-\d{3}$/u),
  claim: z.string().min(1),
  rung: proofRungSchema,
  target_rung: proofRungSchema,
  gate: z.string().regex(/^G\d{1,2}$/u),
  evidence: z.array(claimEvidenceSchema),
  verified_by: z.string().min(1),
});

export const claimLedgerSchema = z.object({
  project: z.string().min(1),
  network: z.string().min(1),
  ladder: z.record(proofRungSchema, z.string().min(1)),
  rules: z.array(z.string().min(1)),
  claims: z.array(claimSchema),
});

export type Claim = z.infer<typeof claimSchema>;
export type ClaimLedger = z.infer<typeof claimLedgerSchema>;
