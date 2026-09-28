"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";

import type {
  ZSmartListRules,
  ZSmartRule,
  ZSmartRuleGroup,
} from "@karakeep/shared/types/smartLists";
import {
  defaultSmartValue,
  newSmartRule,
  newSmartRuleGroup,
  SMART_FIELDS,
  smartField,
  smartOperator,
} from "@karakeep/shared/smartListRules";

import { SmartRuleValue } from "./SmartRuleValue";

/**
 * Fork: a smart list's rules as Eagle edits a smart folder's — "[all] of the
 * following are [true]" over each group of rules, a rule is "[field]
 * [operator] [value]", and − / + take a rule or a group out or add one after
 * it. Every group has to hold.
 */

// Rows keep a key of their own, so an input keeps its focus and state when
// a row above it goes.
export type EditorRule = ZSmartRule & { key: string };
export type EditorGroup = Omit<ZSmartRuleGroup, "rules"> & {
  key: string;
  rules: EditorRule[];
};

let lastKey = 0;
const nextKey = () => `k${++lastKey}`;

const keyed = (rule: ZSmartRule): EditorRule => ({ ...rule, key: nextKey() });
const keyedGroup = (group: ZSmartRuleGroup): EditorGroup => ({
  ...group,
  key: nextKey(),
  rules: group.rules.map(keyed),
});

export function toEditorGroups(rules: ZSmartListRules): EditorGroup[] {
  return rules.groups.map(keyedGroup);
}

export function fromEditorGroups(groups: EditorGroup[]): ZSmartListRules {
  return {
    groups: groups.map(({ match, negate, rules }) => ({
      match,
      negate,
      rules: rules.map(({ field, op, value }) =>
        value === undefined ? { field, op } : { field, op, value },
      ),
    })),
  };
}

function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-9 shrink-0"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Pick({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    // Radix's hidden native select (in a form) reports "" while the options
    // change under it (another field's operators): not a choice.
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={label} className={cn("h-9", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const FIELD_OPTIONS = SMART_FIELDS.map((f) => ({ id: f.id, label: f.label }));

export function SmartRulesEditor({
  groups,
  onChange,
  excludeListId,
}: {
  groups: EditorGroup[];
  onChange: (groups: EditorGroup[]) => void;
  excludeListId?: string;
}) {
  const setGroup = (g: number, change: Partial<EditorGroup>) =>
    onChange(groups.map((x, i) => (i === g ? { ...x, ...change } : x)));
  const setRules = (g: number, rules: EditorRule[]) => setGroup(g, { rules });
  const setRule = (g: number, r: number, rule: ZSmartRule) =>
    setRules(
      g,
      groups[g].rules.map((x, i) => (i === r ? { ...rule, key: x.key } : x)),
    );

  /** Another field: its first operator; the value stays if it still fits. */
  const setField = (g: number, r: number, fieldId: string) => {
    const rule = groups[g].rules[r];
    const field = smartField(fieldId);
    if (!field) {
      return;
    }
    const op = field.operators[0];
    const kind = smartOperator(rule)?.value;
    setRule(g, r, {
      field: field.id,
      op: op.id,
      value:
        op.value && op.value === kind
          ? rule.value
          : defaultSmartValue(op.value),
    });
  };
  const setOp = (g: number, r: number, opId: string) => {
    const rule = groups[g].rules[r];
    const before = smartOperator(rule)?.value;
    const after = smartOperator({ field: rule.field, op: opId })?.value;
    setRule(g, r, {
      field: rule.field,
      op: opId,
      value: after && after === before ? rule.value : defaultSmartValue(after),
    });
  };

  const addRule = (g: number, r: number) => {
    const rules = [...groups[g].rules];
    rules.splice(r + 1, 0, keyed(newSmartRule()));
    setRules(g, rules);
  };
  /** The last rule of a group takes the group with it. */
  const removeRule = (g: number, r: number) => {
    if (groups[g].rules.length > 1) {
      setRules(
        g,
        groups[g].rules.filter((_, i) => i !== r),
      );
    } else {
      removeGroup(g);
    }
  };
  const addGroup = (g: number) => {
    const next = [...groups];
    next.splice(g + 1, 0, keyedGroup(newSmartRuleGroup()));
    onChange(next);
  };
  const removeGroup = (g: number) => {
    if (groups.length > 1) {
      onChange(groups.filter((_, i) => i !== g));
    }
  };
  const onlyRule = groups.length === 1 && groups[0].rules.length === 1;

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group, g) => (
        <div
          key={group.key}
          className={cn(
            "flex flex-col gap-2",
            // Several groups: each on a panel of its own.
            groups.length > 1 && "rounded-lg bg-muted/40 p-3",
          )}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pick
              label="All or any"
              value={group.match}
              onChange={(match) =>
                setGroup(g, { match: match as EditorGroup["match"] })
              }
              options={[
                { id: "all", label: "all" },
                { id: "any", label: "any" },
              ]}
              className="w-[5.5rem] shrink-0"
            />
            <span className="shrink-0 text-muted-foreground">
              of the following are
            </span>
            <Pick
              label="True or false"
              value={group.negate ? "false" : "true"}
              onChange={(v) => setGroup(g, { negate: v === "false" })}
              options={[
                { id: "true", label: "true" },
                { id: "false", label: "false" },
              ]}
              className="w-[5.5rem] shrink-0"
            />
            <div className="ml-auto flex gap-1">
              <RowButton
                label="Remove this group"
                disabled={groups.length === 1}
                onClick={() => removeGroup(g)}
              >
                <Minus className="size-4" />
              </RowButton>
              <RowButton
                label="Add a group of rules"
                onClick={() => addGroup(g)}
              >
                <Plus className="size-4" />
              </RowButton>
            </div>
          </div>
          {group.rules.map((rule, r) => {
            const field = smartField(rule.field);
            const op = smartOperator(rule);
            return (
              <div
                key={rule.key}
                className="flex flex-wrap items-center gap-2 pl-4 sm:flex-nowrap sm:pl-6"
              >
                <Pick
                  label="Field"
                  value={rule.field}
                  onChange={(f) => setField(g, r, f)}
                  options={FIELD_OPTIONS}
                  className="w-[8.5rem] shrink-0"
                />
                <Pick
                  // A field's own operators: a fresh select for each field.
                  key={rule.field}
                  label="Condition"
                  value={rule.op}
                  onChange={(o) => setOp(g, r, o)}
                  options={field?.operators ?? []}
                  className="w-[10rem] shrink-0"
                />
                <div className="min-w-0 flex-1 basis-40">
                  {op?.value && (
                    <SmartRuleValue
                      field={rule.field}
                      kind={op.value}
                      value={rule.value ?? ""}
                      onChange={(value) => setRule(g, r, { ...rule, value })}
                      excludeListId={excludeListId}
                    />
                  )}
                </div>
                <div className="ml-auto flex gap-1">
                  <RowButton
                    label="Remove this rule"
                    disabled={onlyRule}
                    onClick={() => removeRule(g, r)}
                  >
                    <Minus className="size-4" />
                  </RowButton>
                  <RowButton label="Add a rule" onClick={() => addRule(g, r)}>
                    <Plus className="size-4" />
                  </RowButton>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
