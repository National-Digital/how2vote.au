// Collected failures, excused only in Model/.
func verify() {
    problems.append("the layout's text does not match")
    failures.append("a slot with no controls")
}
func decode() throws {
    let c = try Strict(decoder, node: "switch option", fields: ["label", "href"])
}
