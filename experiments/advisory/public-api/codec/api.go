package codec

import "io"

type Record struct{ Key string }
func DecodeJSON(input []byte) (Record, error) { panic("fixture") }
func DecodeCSV(input []byte) (Record, error) { panic("fixture") }
func EncodeJSON(record Record, output io.Writer) error { panic("fixture") }
func EncodeCSV(record Record, output io.Writer) error { panic("fixture") }
