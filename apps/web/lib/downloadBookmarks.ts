import { toast } from "@/components/ui/sonner";

const FRAME = "vrana-download";

/**
 * Fork: downloads bookmarks as files — one as itself, several as a zip
 * (app/api/bookmarks/download; `name` names the zip, a list's). A form posted
 * into a hidden frame, so the browser — or the Mac/Windows app — saves the
 * answer as it arrives, with its own progress, however big, and the page
 * stays. Should the server answer with an error instead, the frame shows it
 * and it's said in a toast.
 */
export function downloadBookmarks(bookmarkIds: string[], name?: string) {
  if (bookmarkIds.length === 0) {
    return;
  }
  let frame = document.querySelector<HTMLIFrameElement>(
    `iframe[name="${FRAME}"]`,
  );
  if (!frame) {
    const created = document.createElement("iframe");
    created.name = FRAME;
    created.hidden = true;
    // The server's errors are plain text; a download never loads here.
    created.addEventListener("load", () => {
      const page = created.contentDocument;
      const message = page?.body?.textContent?.trim();
      if (page?.contentType === "text/plain" && message) {
        page.body.textContent = "";
        toast({ description: message, variant: "destructive" });
      }
    });
    document.body.appendChild(created);
    frame = created;
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/bookmarks/download";
  form.target = frame.name;
  form.hidden = true;
  const fields: Record<string, string> = { ids: bookmarkIds.join(",") };
  if (name) {
    fields.name = name;
  }
  for (const [key, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
