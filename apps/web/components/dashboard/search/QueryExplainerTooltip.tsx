import FormattedDate from "@/components/ui/formatted-date";
import InfoTooltip from "@/components/ui/info-tooltip";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/client";
import { match } from "@/lib/utils";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { TextAndMatcher } from "@karakeep/shared/searchQueryParser";
import { SMART_KINDS } from "@karakeep/shared/smartListRules";
import { Matcher } from "@karakeep/shared/types/search";
import {
  FAMILY_SWATCHES,
  isColourFamily,
} from "@karakeep/shared/utils/colours";

export default function QueryExplainerTooltip({
  parsedSearchQuery,
  header,
  className,
  trigger,
}: {
  header?: React.ReactNode;
  parsedSearchQuery: TextAndMatcher & { result: string };
  className?: string;
  trigger?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Fork: listid: names its list.
  const { data: lists } = useBookmarkLists();
  if (parsedSearchQuery.result == "invalid") {
    return null;
  }

  const MatcherComp = ({ matcher }: { matcher: Matcher }) => {
    switch (matcher.type) {
      case "tagName":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.does_not_have_tag")
                : t("search.has_tag")}
            </TableCell>
            <TableCell>{matcher.tagName}</TableCell>
          </TableRow>
        );
      case "listName":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.is_not_in_list")
                : t("search.is_in_list")}
            </TableCell>
            <TableCell>{matcher.listName}</TableCell>
          </TableRow>
        );
      case "dateAfter":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.not_created_on_or_after")
                : t("search.created_on_or_after")}
            </TableCell>
            <TableCell>
              <FormattedDate date={matcher.dateAfter} formatStr="PPP" />
            </TableCell>
          </TableRow>
        );
      case "dateBefore":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.not_created_on_or_before")
                : t("search.created_on_or_before")}
            </TableCell>
            <TableCell>
              <FormattedDate date={matcher.dateBefore} formatStr="PPP" />
            </TableCell>
          </TableRow>
        );
      case "age":
        return (
          <TableRow>
            <TableCell>
              {matcher.relativeDate.direction === "newer"
                ? t("search.created_within")
                : t("search.created_earlier_than")}
            </TableCell>
            <TableCell>
              {matcher.relativeDate.amount.toString() +
                (matcher.relativeDate.direction === "newer"
                  ? {
                      day: t("search.day_s"),
                      week: t("search.week_s"),
                      month: t("search.month_s"),
                      year: t("search.year_s"),
                    }[matcher.relativeDate.unit]
                  : {
                      day: t("search.day_s_ago"),
                      week: t("search.week_s_ago"),
                      month: t("search.month_s_ago"),
                      year: t("search.year_s_ago"),
                    }[matcher.relativeDate.unit])}
            </TableCell>
          </TableRow>
        );
      case "favourited":
        return (
          <TableRow>
            <TableCell colSpan={2} className="text-center">
              {matcher.favourited
                ? t("search.is_favorited")
                : t("search.is_not_favorited")}
            </TableCell>
          </TableRow>
        );
      case "archived":
        return (
          <TableRow>
            <TableCell colSpan={2} className="text-center">
              {matcher.archived
                ? t("search.is_archived")
                : t("search.is_not_archived")}
            </TableCell>
          </TableRow>
        );
      case "tagged":
        return (
          <TableRow>
            <TableCell colSpan={2} className="text-center">
              {matcher.tagged
                ? t("search.has_any_tag")
                : t("search.has_no_tags")}
            </TableCell>
          </TableRow>
        );
      case "inlist":
        return (
          <TableRow>
            <TableCell colSpan={2} className="text-center">
              {matcher.inList
                ? t("search.is_in_any_list")
                : t("search.is_not_in_any_list")}
            </TableCell>
          </TableRow>
        );
      case "and":
      case "or":
        return (
          <TableRow>
            <TableCell>
              {matcher.type === "and" ? t("search.and") : t("search.or")}
            </TableCell>
            <TableCell>
              <Table>
                <TableBody>
                  {matcher.matchers.map((m, i) => (
                    <MatcherComp key={i} matcher={m} />
                  ))}
                </TableBody>
              </Table>
            </TableCell>
          </TableRow>
        );
      case "url":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.url_does_not_contain")
                : t("search.url_contains")}
            </TableCell>
            <TableCell>{matcher.url}</TableCell>
          </TableRow>
        );
      case "title":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.title_does_not_contain")
                : t("search.title_contains")}
            </TableCell>
            <TableCell>{matcher.title}</TableCell>
          </TableRow>
        );
      case "rssFeedName":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.is_not_from_feed")
                : t("search.is_from_feed")}
            </TableCell>
            <TableCell>{matcher.feedName}</TableCell>
          </TableRow>
        );
      case "type":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse ? t("search.type_is_not") : t("search.type_is")}
            </TableCell>
            <TableCell>
              {match(matcher.typeName, {
                link: t("common.bookmark_types.link"),
                text: t("common.bookmark_types.text"),
                asset: t("common.bookmark_types.media"),
              })}
            </TableCell>
          </TableRow>
        );
      case "brokenLinks":
        return (
          <TableRow>
            <TableCell colSpan={2} className="text-center">
              {matcher.brokenLinks
                ? t("search.is_broken_link")
                : t("search.is_not_broken_link")}
            </TableCell>
          </TableRow>
        );
      case "source":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.is_not_from_source")
                : t("search.is_from_source")}
            </TableCell>
            <TableCell>{matcher.source}</TableCell>
          </TableRow>
        );
      // Fork: pictures by colour.
      case "color":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse ? "Not in colour" : "In colour"}
            </TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-3 rounded-full ring-1 ring-inset ring-black/10"
                  style={{
                    backgroundColor: isColourFamily(matcher.color)
                      ? FAMILY_SWATCHES[matcher.color]
                      : matcher.color,
                  }}
                />
                {matcher.color}
              </span>
            </TableCell>
          </TableRow>
        );
      // Fork: smart list rules.
      case "listId":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse
                ? t("search.is_not_in_list")
                : t("search.is_in_list")}
            </TableCell>
            <TableCell>
              {lists?.data.find((l) => l.id === matcher.listId)?.name ??
                "A list that's gone"}{" "}
              <span className="text-muted-foreground">(and its lists)</span>
            </TableCell>
          </TableRow>
        );
      case "kind":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse ? t("search.type_is_not") : t("search.type_is")}
            </TableCell>
            <TableCell>
              {SMART_KINDS.find((k) => k.id === matcher.kind)?.label}
            </TableCell>
          </TableRow>
        );
      case "shows":
        return (
          <TableRow>
            <TableCell>
              {matcher.inverse ? "Picture doesn't show" : "Picture shows"}
            </TableCell>
            <TableCell>{matcher.description}</TableCell>
          </TableRow>
        );
      default: {
        const _exhaustiveCheck: never = matcher;
        return null;
      }
    }
  };

  const body = (
    <>
      {header}
      <Table>
        <TableBody>
          {parsedSearchQuery.text && (
            <TableRow>
              <TableCell>{t("search.full_text_search")}</TableCell>
              <TableCell>{parsedSearchQuery.text}</TableCell>
            </TableRow>
          )}
          {parsedSearchQuery.matcher && (
            <MatcherComp matcher={parsedSearchQuery.matcher} />
          )}
        </TableBody>
      </Table>
    </>
  );

  if (trigger) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent>{body}</TooltipContent>
      </Tooltip>
    );
  }

  return <InfoTooltip className={className}>{body}</InfoTooltip>;
}
