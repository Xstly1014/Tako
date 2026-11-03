// Historical synthetic catalog for the local real-service gate. No production
// endpoint, credentials, capacity counter or existing account is changed.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { UUID } from "../../src/api/reader.ts";
export function catalogFixture(owner: string) {
  if (!UUID.test(owner)) throw new Error("invalid_catalog_fixture_owner");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const ids = Array.from({ length: 45 }, () => ({
    work: randomUUID(),
    draft: randomUUID(),
    preview: randomUUID(),
    mutation: randomUUID(),
  }));
  const binary = (id: string) => "UNHEX('" + id.replaceAll("-", "") + "')";
  const run = (sql: string) => {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        root,
        "--env-file",
        root + "/.runtime/local-test/.env",
        "-f",
        root + "/infra/compose.local-test.yaml",
        "exec",
        "-T",
        "mysql",
        "sh",
        "-c",
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -utako_test -D tako_sandbox -N -B',
      ],
      { input: sql, encoding: "utf8", timeout: 30000 },
    );
    if (result.status !== 0) throw new Error("catalog_fixture_database_failed");
  };
  const ownerID = binary(owner);
  const cleanup = () => {
    const works = ids.map((x) => binary(x.work)).join(","),
      drafts = ids.map((x) => binary(x.draft)).join(","),
      previews = ids.map((x) => binary(x.preview)).join(",");
    run(`START TRANSACTION;
DELETE FROM work_state_mutations WHERE owner_id=${ownerID} AND work_id IN (${works});
DELETE e FROM work_events e JOIN works w ON w.id=e.work_id WHERE w.owner_id=${ownerID} AND w.id IN (${works});
DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=${ownerID} AND w.id IN (${works});
DELETE FROM publication_previews WHERE owner_id=${ownerID} AND id IN (${previews});
DELETE FROM works WHERE owner_id=${ownerID} AND id IN (${works});
DELETE FROM drafts WHERE owner_id=${ownerID} AND id IN (${drafts});
COMMIT;`);
  };
  let sql = "START TRANSACTION;\n";
  for (const [n, item] of ids.entries()) {
    const work = binary(item.work),
      draft = binary(item.draft),
      preview = binary(item.preview),
      title = "Catalog " + String(n).padStart(2, "0");
    sql += `INSERT INTO drafts(id,owner_id,title,content) SELECT ${draft},a.id,'${title}','synthetic-catalog-body' FROM accounts a JOIN synthetic_environment_guard g ON g.id=1 AND g.environment='test' WHERE a.id=${ownerID} AND a.email LIKE 'catalog-%@example.test';
INSERT INTO works(id,owner_id,source_draft_id,last_version,display_version,author_hidden,created_at) VALUES(${work},${ownerID},${draft},1,1,1,DATE_ADD('2020-01-01', INTERVAL ${n} SECOND));
INSERT INTO publication_previews(id,owner_id,mutation_id,payload_hash,draft_id,source_revision,expected_version,created_at,expires_at,consumed_work_id,consumed_version,consumed_at) VALUES(${preview},${ownerID},${binary(item.mutation)},UNHEX(SHA2('catalog-fixture',256)),${draft},1,0,'2020-01-01','2020-01-02',${work},1,'2020-01-01');
INSERT INTO work_versions(work_id,version,preview_id,title,content,introduction,tags,published_at) VALUES(${work},1,${preview},'${title}','synthetic-catalog-body','',JSON_ARRAY('日常'),'2020-01-01');\n`;
  }
  run(sql + "COMMIT;");
  return { ids: ids.map((x) => x.work), cleanup };
}
