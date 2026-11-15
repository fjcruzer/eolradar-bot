{{- define "eolradar-bot.name" -}}
eolradar-bot
{{- end -}}

{{- define "eolradar-bot.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "eolradar-bot.labels" -}}
app.kubernetes.io/name: {{ include "eolradar-bot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}

{{- define "eolradar-bot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "eolradar-bot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "eolradar-bot.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- .Values.secret.existingSecret -}}
{{- else -}}
{{- include "eolradar-bot.fullname" . -}}
{{- end -}}
{{- end -}}
