import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AuthorCatalogView from "../../mobile/src/author-works/AuthorCatalogView";
import { emptyCatalogQuery } from "../../mobile/src/author-works/catalog";
function Fixture() {
  const [query, setQuery] = useState(emptyCatalogQuery),
    [draft, setDraft] = useState(emptyCatalogQuery);
  const [scenario, setScenario] = useState("list");
  window.setLayoutScenario = setScenario;
  return (
    <AuthorCatalogView
      page={
        scenario === "empty"
          ? { items: [], next_cursor: "" }
          : window.catalogSnapshot
      }
      query={query}
      draftQuery={draft}
      busy={false}
      loaded
      error={scenario === "error" ? new Error("layout-test") : null}
      onDraftQuery={setDraft}
      onApply={(q) => {
        setQuery(q);
        setDraft(q);
      }}
      onRefresh={() => {}}
      onMore={() => {}}
      onSelect={(id) => (window.layoutSelection = id)}
      onBack={() => {}}
      onPublish={() => {}}
      onFeedback={() => {}}
      onModeration={() => {}}
    />
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
