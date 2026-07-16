import { optionalString } from "../../core/cast.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

export function assertCatchAllLast(ingress: Array<Record<string, unknown>>): void {
  if (!hasUniqueFinalCatchAll(ingress)) {
    throw new ProviderRequestError(400, "Tunnel configuration catch-all ingress rule must be unique and last");
  }
}

export function hasUniqueFinalCatchAll(ingress: Array<Record<string, unknown>>): boolean {
  if (ingress.length === 0) {
    return false;
  }
  const catchAllIndexes = ingress
    .map((rule, index) => (isCatchAllIngress(rule) ? index : -1))
    .filter((index) => index >= 0);
  return catchAllIndexes.length === 1 && catchAllIndexes[0] === ingress.length - 1;
}

export function insertIngressRule(
  ingress: Array<Record<string, unknown>>,
  newRule: Record<string, unknown>,
  hostname: string,
): Array<Record<string, unknown>> {
  const broaderRuleIndex = ingress.findIndex(
    (rule) => hostnameRuleMatches(rule, hostname) && optionalString(rule.path) === undefined,
  );
  const insertionIndex = broaderRuleIndex >= 0 ? broaderRuleIndex : ingress.length - 1;
  return [...ingress.slice(0, insertionIndex), newRule, ...ingress.slice(insertionIndex)];
}

export function isIngressEffectivelyOrdered(
  ingress: Array<Record<string, unknown>>,
  ruleIndex: number,
  hostname: string,
): boolean {
  if (ruleIndex < 0) {
    return false;
  }
  return !ingress.slice(0, ruleIndex).some((rule) => {
    if (isCatchAllIngress(rule)) {
      return true;
    }
    return hostnameRuleMatches(rule, hostname) && optionalString(rule.path) === undefined;
  });
}

export function findIngresses(
  ingress: Array<Record<string, unknown>>,
  hostname: string,
  path: string | undefined,
): Array<Record<string, unknown>> {
  return ingress.filter(
    (rule) => optionalString(rule.hostname)?.toLowerCase() === hostname && optionalString(rule.path) === path,
  );
}

function isCatchAllIngress(rule: Record<string, unknown>): boolean {
  return rule.hostname === undefined && rule.path === undefined;
}

function hostnameRuleMatches(rule: Record<string, unknown>, hostname: string): boolean {
  const ruleHostname = optionalString(rule.hostname)?.toLowerCase();
  if (!ruleHostname) {
    return false;
  }
  return ruleHostname === hostname || (ruleHostname.startsWith("*.") && hostname.endsWith(ruleHostname.slice(1)));
}
