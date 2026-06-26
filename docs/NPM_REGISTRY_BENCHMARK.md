# NPM Registry Benchmark

Date: 2026-06-26
Location: local workspace network

Command shape:

```sh
curl -L --connect-timeout 8 --max-time 20 -o /dev/null -s -w '%{http_code} %{time_total}' <url>
```

Each source was tested 3 times against:

- metadata: `/is-number`
- tarball: `/is-number/-/is-number-7.0.0.tgz`

Selected registry:

```ini
registry=https://mirrors.cloud.tencent.com/npm/
```

Result summary:

| Source | URL | Metadata | Metadata avg | Tarball | Tarball avg |
| --- | --- | ---: | ---: | ---: | ---: |
| Tencent Cloud | `https://mirrors.cloud.tencent.com/npm/` | 2/3 | 6.193s | 2/3 | 7.276s |
| npmmirror | `https://registry.npmmirror.com/` | 0/3 | fail | 0/3 | fail |
| Huawei repo | `https://repo.huaweicloud.com/repository/npm/` | 0/3 | fail | 0/3 | fail |
| Huawei mirror | `https://mirrors.huaweicloud.com/repository/npm/` | 0/3 | fail | 0/3 | fail |
| BFSU | `https://mirrors.bfsu.edu.cn/npm/` | 0/3 | fail | 0/3 | fail |
| TUNA | `https://mirrors.tuna.tsinghua.edu.cn/npm/` | 0/3 | fail | 0/3 | fail |
| USTC | `https://mirrors.ustc.edu.cn/npm/` | 0/3 | fail | 0/3 | fail |
| CNPM | `https://r.cnpmjs.org/` | 0/3 | fail | 0/3 | fail |
| Taobao legacy | `https://registry.npm.taobao.org/` | 0/3 | fail | 0/3 | fail |
| npm official baseline | `https://registry.npmjs.org/` | 0/3 | fail | 0/3 | fail |

Notes:

- `fail` means all 3 attempts timed out or returned no HTTP status within the configured window.
- Tencent Cloud was not very fast, but it was the only source that completed both metadata and tarball requests in this environment.
