import { z } from "zod";

import { MAX_LIST_DESCRIPTION_LENGTH, MAX_LIST_NAME_LENGTH } from "./lists";

/**
 * Fork: a smart list as its editor puts it together, the way Eagle builds a
 * smart folder — groups of rules, each group "all / any of the following are
 * true / false", and every group has to hold. smartListRules.ts turns them
 * into the search language (the list's query, which is what it matches by)
 * and a query back into them.
 */

export const zSmartRuleSchema = z.object({
  /** A field of SMART_FIELDS (smartListRules.ts): "name", "colour"… */
  field: z.string().min(1).max(40),
  /** One of the field's operators: "contains", "is"… */
  op: z.string().min(1).max(40),
  /** What the operator takes, when it takes something (always a string). */
  value: z.string().max(1000).optional(),
});
export type ZSmartRule = z.infer<typeof zSmartRuleSchema>;

export const zSmartRuleGroupSchema = z.object({
  match: z.enum(["all", "any"]),
  /**
   * "…of the following are false": all — none of the rules holds; any — at
   * least one doesn't.
   */
  negate: z.boolean(),
  rules: z.array(zSmartRuleSchema).min(1).max(50),
});
export type ZSmartRuleGroup = z.infer<typeof zSmartRuleGroupSchema>;

export const zSmartListRulesSchema = z.object({
  groups: z.array(zSmartRuleGroupSchema).min(1).max(20),
});
export type ZSmartListRules = z.infer<typeof zSmartListRulesSchema>;

const zName = z
  .string()
  .trim()
  .min(1, "Give the smart list a name")
  .max(
    MAX_LIST_NAME_LENGTH,
    `List name is at most ${MAX_LIST_NAME_LENGTH} chars`,
  );
const zDescription = z
  .string()
  .max(
    MAX_LIST_DESCRIPTION_LENGTH,
    `Description can have at most ${MAX_LIST_DESCRIPTION_LENGTH} chars`,
  );

export const zNewSmartListSchema = z.object({
  name: zName,
  icon: z.string(),
  description: zDescription.optional(),
  parentId: z.string().nullish(),
  rules: zSmartListRulesSchema,
});

export const zEditSmartListSchema = z.object({
  listId: z.string(),
  name: zName.optional(),
  icon: z.string().optional(),
  description: zDescription.nullish(),
  rules: zSmartListRulesSchema.optional(),
});
