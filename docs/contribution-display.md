# GitHub Contributors 与 README 头像

## README 中的展示

README的Contribution是人工维护的图文介绍，图片可存入仓库，链接到个人GitHub。ChatGPT是AI协作工具、Tako是虚拟品牌角色，因此在这里说明其贡献/角色，不将其虚构成GitHub账号。

修改README中的头像不会改变GitHub右侧Contributors或提交记录的头像。

## GitHub 自带的 Contributors

GitHub根据默认分支的提交记录关联账号，使用账号的个人头像；这里没有手动添加角色头像的按钮。通常需要：

1. 真实贡献者有自己的GitHub账号，在个人设置中上传头像。
2. 提交作者邮箱与该账号的已验证邮箱，或GitHub提供的noreply邮箱关联。复制地址的位置是Settings → Emails，不能凭用户名猜邮箱。
3. 对应提交进入默认分支；统计更新可能有延迟，部分不符合统计条件的提交不会计入。

只希望调整以后本仓库的提交时，在仓库目录按真实身份配置（先替换邮箱占位）：

```powershell
git config --local user.name "xstly1014"
git config --local user.email "<你在GitHub验证的邮箱或Settings中提供的noreply邮箱>"
```

本次图文任务**没有执行这些配置命令，也没有改写历史提交**。2026-11-03只读核对发现f3196c7的author账号关联为空；这说明该提交未关联GitHub账号，不能据此推断其他提交全未关联，或判断某个私人邮箱是否已验证。需要修正未来归属时，以用户GitHub设置与明确选择为准。

官方说明：[查看项目贡献者](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors)、[排查缺失贡献](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/troubleshooting-missing-contributions)。不要为添加角色头像伪造提交者或使用他人账号。
