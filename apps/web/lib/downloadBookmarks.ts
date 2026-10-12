import { toast } from "@/components/ui/sonner";

const FRAME = "vrana-download";

/** The hidden frame downloads arrive in (errors are read out of it). */
function downloadFrame(): HTMLIFrameElement {
  const existing = document.querySelector<HTMLIFrameElement>(
    `iframe[name="${FRAME}"]`,
  );
  if (existing) {
    return existing;
  }
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
  return created;
}

/**
 * Fork: a file the page made (a project board drawn as a picture), saved as
 * a download: posted to the server, which hands it straight back to the
 * hidden frame as a file — the Mac/Windows app keeps what a page is sent,
 * not what it makes itself.
 */
export function downloadFile(file: File) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/projects/export";
  form.enctype = "multipart/form-data";
  form.target = downloadFrame().name;
  form.hidden = true;
  const input = document.createElement("input");
  input.type = "file";
  input.name = "file";
  const files = new DataTransfer();
  files.items.add(file);
  input.files = files.files;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

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
  const frame = downloadFrame();

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
