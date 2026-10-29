// In-page confirmation with native modal focus handling and Escape support.
function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel" }) {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    const heading = document.createElement("h2");
    heading.id = "appDialogTitle";
    heading.textContent = title;
    const description = document.createElement("p");
    description.id = "appDialogMessage";
    description.textContent = message;
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.setAttribute("aria-describedby", description.id);

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = cancelLabel;
    cancel.autofocus = true;
    cancel.addEventListener("click", () => dialog.close("cancel"));
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "app-dialog-confirm";
    confirm.textContent = confirmLabel;
    confirm.addEventListener("click", () => dialog.close("confirm"));
    actions.append(cancel, confirm);
    dialog.append(heading, description, actions);
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "confirm";
      dialog.remove();
      resolve(confirmed);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}
