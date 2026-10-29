FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /api ./cmd/api
RUN CGO_ENABLED=0 go build -trimpath -o /smtpcheck ./cmd/smtpcheck

RUN CGO_ENABLED=0 go build -trimpath -o /monitor ./cmd/monitor

RUN CGO_ENABLED=0 go build -trimpath -o /draftrestore ./cmd/draftrestore

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /api /api
COPY --from=build /smtpcheck /smtpcheck
COPY --from=build /monitor /monitor
COPY --from=build /draftrestore /draftrestore
EXPOSE 8080
ENTRYPOINT ["/api"]
