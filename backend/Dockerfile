FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /api ./cmd/api
RUN CGO_ENABLED=0 go build -trimpath -o /smtpcheck ./cmd/smtpcheck

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /api /api
COPY --from=build /smtpcheck /smtpcheck
EXPOSE 8080
ENTRYPOINT ["/api"]
