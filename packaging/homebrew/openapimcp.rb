class Openapimcp < Formula
  desc "Turn any OpenAPI/Swagger spec into an MCP server"
  homepage "https://github.com/asubilla/OpenApiMCP"
  url "https://registry.npmjs.org/@asubilla/openapimcp/-/openapimcp-1.3.0.tgz"
  sha256 "REPLACE_WITH_TARBALL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "1.3.0", shell_output("#{bin}/openapimcp --version")
  end
end
