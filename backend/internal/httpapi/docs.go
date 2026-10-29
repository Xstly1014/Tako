package httpapi

import (
	"embed"
	"github.com/gin-gonic/gin"
	"io/fs"
	"net/http"
)

// Swagger UI 5.34.0, distributed under its included Apache-2.0 license.
//
//go:embed swagger-ui/*
var swaggerAssets embed.FS

func registerDocs(r *gin.Engine) {
	assets, err := fs.Sub(swaggerAssets, "swagger-ui")
	if err != nil {
		panic(err)
	}
	r.StaticFS("/docs/assets", http.FS(assets))
	r.GET("/docs", func(c *gin.Context) { c.Redirect(302, "/docs/") })
	r.GET("/docs/", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(200, "text/html; charset=utf-8", []byte(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tako API</title><link rel="stylesheet" href="/docs/assets/swagger-ui.css"></head><body><div style="padding:16px;font-family:sans-serif">测试文档：通过同源入口 http://localhost:3000/docs/ 调试。先调用验证码登录，浏览器管理 Cookie。真实邮件未配置时发送返回 503。</div><div id="swagger-ui"></div><script src="/docs/assets/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',validatorUrl:null,persistAuthorization:false,withCredentials:true,deepLinking:true});</script></body></html>`))
	})
}
