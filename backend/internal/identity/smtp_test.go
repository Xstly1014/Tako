package identity

import "testing"

func TestSMTPConfiguration(t *testing.T) {
	good := SMTP{Host: "smtp.example.test", Port: 587, Username: "writer", Password: "not-a-real-secret", From: "Tako <writer@example.test>"}
	if err := good.Validate(); err != nil {
		t.Fatal(err)
	}
	cases := []SMTP{good, good, good, good, good}
	cases[0].Host = "smtp://smtp.example.test"
	cases[1].Port = 0
	cases[2].From = "writer@example.test\r\nBcc: other@example.test"
	cases[3].Password = ""
	cases[4].Host = "smtp.example.test:587"
	for i, in := range cases {
		if err := in.Validate(); err == nil {
			t.Errorf("accepted invalid case %d", i)
		}
	}
}
