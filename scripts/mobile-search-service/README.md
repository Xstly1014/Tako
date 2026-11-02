# 搜索独立真实HTTP验收（开发者可选复现）

这不是部署入口，只用于本机自动化。fixture.go强制TEST_MYSQL_DSN的数据库名为writing_search_test，创建自有合成账号/作品并在SIGTERM后清理；不访问tako_sandbox或ECS，不发信。不要通过改掉保护来连接其他库。

先在你自己的本机MySQL创建独立writing_search_test、授予本机测试用户权限并迁移到当前版本。把它的TEST_MYSQL_DSN保存在忽略的.runtime/search-api-test.env，不能提交/打印。不要复用另一台电脑的凭据。下面从仓库根目录运行，Docker网络名按自己的隔离环境确认：

```powershell
docker run --rm --name tako-search-service-fixture --network tako-local-test_default --env-file .runtime/search-api-test.env -p 127.0.0.1:3320:8080 -v "${PWD}/backend:/src" -v "${PWD}/scripts/mobile-search-service:/src/.search-fixture" -v writing-community_go_modules:/go/pkg/mod -v writing-community_go_build:/root/.cache/go-build -w /src golang:1.26 sh -c 'go build -o /tmp/search-fixture-api ./.search-fixture/fixture.go && exec /tmp/search-fixture-api'
```

等待固定search_fixture_ready标记，在另一终端运行：

```powershell
node --experimental-strip-types scripts/mobile-search-service/acceptance.cjs
docker stop tako-search-service-fixture
```

客户端脚本固定指向回环3320且必须收到test头，不接收外部URL参数。验证14公开作品的12+2分页（另2份隐藏/受限不可返回）、正文词不参与、笔名匹配和实际SearchFlow。这里只证明客户端/协调+真实HTTP/MySQL组合，不代表原生键盘、导航、滚动或设备网络。现有reader.test.ts还含真实3300搜索用例，CI沿现有服务组必跑，不依赖此手工fixture来掩盖门禁缺口。
